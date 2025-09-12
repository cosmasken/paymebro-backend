const request = require('supertest');
const express = require('express');
const { PublicKey, Keypair, Connection, Transaction, SystemProgram } = require('@solana/web3.js');
const { encodeURL } = require('@solana/pay');
const BigNumber = require('bignumber.js');
const database = require('../../src/services/database');
const paymentMonitor = require('../../src/services/paymentMonitor');
const { createPayment, getPayment, confirmPayment } = require('../../src/controllers/payments');
const { asyncHandler } = require('../../src/middleware/errorHandler');
const logger = require('../../src/utils/logger');

// Mock external dependencies
jest.mock('../../src/services/database');
jest.mock('../../src/utils/logger');
jest.mock('../../src/services/websocket');
jest.mock('../../src/services/emailService');
jest.mock('../../src/services/solana');

// Mock Solana connection
const mockConnection = {
    getTransaction: jest.fn(),
    getSignatureStatus: jest.fn(),
    getAccountInfo: jest.fn(),
    getBalance: jest.fn(),
    confirmTransaction: jest.fn(),
    getLatestBlockhash: jest.fn(),
    sendTransaction: jest.fn()
};

// Mock @solana/pay functions
jest.mock('@solana/pay', () => ({
    encodeURL: jest.fn(),
    findReference: jest.fn(),
    validateTransfer: jest.fn(),
    FindReferenceError: class FindReferenceError extends Error {
        constructor(message) {
            super(message);
            this.name = 'FindReferenceError';
        }
    }
}));

const { findReference, validateTransfer, FindReferenceError } = require('@solana/pay');

describe('SOL Payment Integration Tests', () => {
    let app;
    let testUser;
    let testMerchantWallet;
    let testReferenceKeypair;

    beforeAll(() => {
        // Create test app
        app = express();
        app.use(express.json());

        // Add payment routes
        app.post('/payments/create', asyncHandler(createPayment));
        app.get('/payments/:reference', asyncHandler(getPayment));
        app.post('/payments/confirm', asyncHandler(confirmPayment));

        // Setup test data
        testUser = {
            id: 'test-user-123',
            web3auth_user_id: 'web3-test-123',
            solana_address: 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH',
            ethereum_address: '0x1234567890123456789012345678901234567890',
            email: 'test@example.com',
            plan_type: 'free'
        };

        testMerchantWallet = new PublicKey('GDBPQ6G7k9xMFcmz2GqEgmcesC6DRzeWQPfRPk1hQNBo');
        testReferenceKeypair = Keypair.generate();
    });

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup default mocks
        database.getUserById.mockResolvedValue(testUser);
        database.getUserDefaultAddress.mockResolvedValue({
            address: testMerchantWallet.toString(),
            network: 'solana'
        });

        // Mock payment monitor connection
        paymentMonitor.getConnection = jest.fn().mockResolvedValue(mockConnection);
    });

    describe('Complete SOL Payment Creation and Monitoring Cycle', () => {
        it('should create SOL payment and monitor until confirmation', async () => {
            // Step 1: Create SOL payment
            const paymentData = {
                amount: 1.5,
                label: 'Test SOL Payment',
                message: 'Integration test payment',
                web3AuthUserId: testUser.web3auth_user_id,
                chain: 'solana'
            };

            const mockPaymentRecord = {
                id: 'payment-123',
                reference: testReferenceKeypair.publicKey.toString(),
                web3auth_user_id: testUser.web3auth_user_id,
                amount: '1.5',
                currency: 'SOL',
                spl_token_mint: null,
                status: 'pending',
                recipient_address: testMerchantWallet.toString(),
                created_at: new Date().toISOString()
            };

            database.createPayment.mockResolvedValue(mockPaymentRecord);
            encodeURL.mockReturnValue({
                toString: () => `solana:${testMerchantWallet.toString()}?amount=1.5&reference=${testReferenceKeypair.publicKey.toString()}`
            });

            // Create payment
            const createResponse = await request(app)
                .post('/payments/create')
                .send(paymentData)
                .expect(200);

            expect(createResponse.body.success).toBe(true);
            expect(createResponse.body.payment.currency).toBe('SOL');
            expect(createResponse.body.payment.status).toBe('pending');

            // Step 2: Mock successful transaction on Solana
            const mockTransaction = {
                transaction: {
                    message: {
                        version: 'legacy',
                        accountKeys: [
                            testMerchantWallet, // recipient
                            new PublicKey(testUser.solana_address), // sender
                            testReferenceKeypair.publicKey, // reference
                            SystemProgram.programId
                        ],
                        instructions: [
                            {
                                programIdIndex: 3,
                                accounts: [1, 0], // sender to recipient
                                data: Buffer.from([])
                            }
                        ]
                    }
                },
                meta: {
                    err: null,
                    preBalances: [1000000000, 2500000000, 0, 1], // 1 SOL, 2.5 SOL, 0, 1 lamport
                    postBalances: [2500000000, 1000000000, 0, 1], // 2.5 SOL, 1 SOL, 0, 1 lamport (1.5 SOL transfer)
                    fee: 5000 // 5000 lamports fee
                }
            };

            const mockSignature = 'test-signature-123';

            // Mock findReference to return the transaction
            findReference.mockResolvedValue(mockSignature);

            // Mock connection.getTransaction to return the transaction details
            mockConnection.getTransaction.mockResolvedValue(mockTransaction);

            // Step 3: Mock payment monitoring
            database.getClient.mockReturnValue({
                from: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                order: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue({
                    data: [mockPaymentRecord]
                })
            });

            database.updatePaymentStatus.mockResolvedValue(true);

            // Step 4: Run payment monitoring
            await paymentMonitor.checkPendingPayments();

            // Verify payment was found and processed
            expect(findReference).toHaveBeenCalledWith(
                mockConnection,
                testReferenceKeypair.publicKey,
                expect.any(Object)
            );

            expect(mockConnection.getTransaction).toHaveBeenCalledWith(mockSignature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0
            });

            // Step 5: Verify payment status update
            expect(database.updatePaymentStatus).toHaveBeenCalledWith(
                mockPaymentRecord.reference,
                'confirmed',
                mockSignature
            );
        });

        it('should handle SOL payment with memo-based reference', async () => {
            const paymentData = {
                amount: 0.5,
                label: 'Memo SOL Payment',
                message: 'Payment with memo reference',
                web3AuthUserId: testUser.web3auth_user_id,
                chain: 'solana'
            };

            const mockPaymentRecord = {
                id: 'payment-memo-123',
                reference: testReferenceKeypair.publicKey.toString(),
                web3auth_user_id: testUser.web3auth_user_id,
                amount: '0.5',
                currency: 'SOL',
                spl_token_mint: null,
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            };

            database.createPayment.mockResolvedValue(mockPaymentRecord);

            // Create payment
            const createResponse = await request(app)
                .post('/payments/create')
                .send(paymentData)
                .expect(200);

            expect(createResponse.body.success).toBe(true);

            // Mock transaction with memo instruction
            const memoProgram = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
            const mockTransactionWithMemo = {
                transaction: {
                    message: {
                        version: 'legacy',
                        accountKeys: [
                            testMerchantWallet,
                            new PublicKey(testUser.solana_address),
                            SystemProgram.programId,
                            memoProgram
                        ],
                        instructions: [
                            {
                                programIdIndex: 2, // System program
                                accounts: [1, 0],
                                data: Buffer.from([])
                            },
                            {
                                programIdIndex: 3, // Memo program
                                accounts: [],
                                data: Buffer.from(`Payment reference: ${testReferenceKeypair.publicKey.toString()}`, 'utf8')
                            }
                        ]
                    }
                },
                meta: {
                    err: null,
                    preBalances: [500000000, 1000000000, 1, 1],
                    postBalances: [1000000000, 500000000, 1, 1], // 0.5 SOL transfer
                    fee: 5000
                }
            };

            findReference.mockResolvedValue('memo-signature-123');
            mockConnection.getTransaction.mockResolvedValue(mockTransactionWithMemo);

            database.getClient.mockReturnValue({
                from: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                order: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue({
                    data: [mockPaymentRecord]
                })
            });

            // Run monitoring
            await paymentMonitor.checkPendingPayments();

            expect(database.updatePaymentStatus).toHaveBeenCalledWith(
                mockPaymentRecord.reference,
                'confirmed',
                'memo-signature-123'
            );
        });

        it('should handle versioned SOL transactions correctly', async () => {
            const paymentData = {
                amount: 2.0,
                label: 'Versioned SOL Payment',
                message: 'Payment with versioned transaction',
                web3AuthUserId: testUser.web3auth_user_id,
                chain: 'solana'
            };

            const mockPaymentRecord = {
                id: 'payment-versioned-123',
                reference: testReferenceKeypair.publicKey.toString(),
                web3auth_user_id: testUser.web3auth_user_id,
                amount: '2.0',
                currency: 'SOL',
                spl_token_mint: null,
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            };

            database.createPayment.mockResolvedValue(mockPaymentRecord);

            // Create payment
            await request(app)
                .post('/payments/create')
                .send(paymentData)
                .expect(200);

            // Mock versioned transaction
            const mockVersionedTransaction = {
                transaction: {
                    message: {
                        version: 0,
                        getAccountKeys: jest.fn().mockReturnValue([
                            testMerchantWallet,
                            new PublicKey(testUser.solana_address),
                            testReferenceKeypair.publicKey,
                            SystemProgram.programId
                        ]),
                        instructions: [
                            {
                                programIdIndex: 3,
                                accounts: [1, 0],
                                data: Buffer.from([])
                            }
                        ]
                    }
                },
                meta: {
                    err: null,
                    preBalances: [1000000000, 3000000000, 0, 1],
                    postBalances: [3000000000, 1000000000, 0, 1], // 2.0 SOL transfer
                    fee: 5000
                }
            };

            findReference.mockResolvedValue('versioned-signature-123');
            mockConnection.getTransaction.mockResolvedValue(mockVersionedTransaction);

            database.getClient.mockReturnValue({
                from: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                order: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue({
                    data: [mockPaymentRecord]
                })
            });

            // Run monitoring
            await paymentMonitor.checkPendingPayments();

            expect(mockVersionedTransaction.transaction.message.getAccountKeys).toHaveBeenCalled();
            expect(database.updatePaymentStatus).toHaveBeenCalledWith(
                mockPaymentRecord.reference,
                'confirmed',
                'versioned-signature-123'
            );
        });
    });

    describe('SOL Payment Status Updates', () => {
        it('should correctly update SOL payment status from pending to confirmed', async () => {
            const mockPayment = {
                id: 'payment-status-123',
                reference: testReferenceKeypair.publicKey.toString(),
                amount: '1.0',
                currency: 'SOL',
                spl_token_mint: null,
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            };

            // Mock initial pending status
            database.getPayment.mockResolvedValueOnce(mockPayment);

            const response1 = await request(app)
                .get(`/payments/${mockPayment.reference}`)
                .expect(200);

            expect(response1.body.payment.status).toBe('pending');

            // Mock confirmed status after monitoring
            const confirmedPayment = { ...mockPayment, status: 'confirmed', transaction_signature: 'confirmed-sig-123' };
            database.getPayment.mockResolvedValueOnce(confirmedPayment);

            const response2 = await request(app)
                .get(`/payments/${mockPayment.reference}`)
                .expect(200);

            expect(response2.body.payment.status).toBe('confirmed');
            expect(response2.body.payment.transaction_signature).toBe('confirmed-sig-123');
        });

        it('should handle SOL payment validation failures gracefully', async () => {
            const mockPayment = {
                id: 'payment-fail-123',
                reference: testReferenceKeypair.publicKey.toString(),
                amount: '1.0',
                currency: 'SOL',
                spl_token_mint: null,
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            };

            // Mock transaction with insufficient amount
            const mockInsufficientTransaction = {
                transaction: {
                    message: {
                        version: 'legacy',
                        accountKeys: [
                            testMerchantWallet,
                            new PublicKey(testUser.solana_address),
                            testReferenceKeypair.publicKey,
                            SystemProgram.programId
                        ]
                    }
                },
                meta: {
                    err: null,
                    preBalances: [1000000000, 2000000000, 0, 1],
                    postBalances: [1500000000, 1500000000, 0, 1], // Only 0.5 SOL transfer (insufficient)
                    fee: 5000
                }
            };

            findReference.mockResolvedValue('insufficient-sig-123');
            mockConnection.getTransaction.mockResolvedValue(mockInsufficientTransaction);

            database.getClient.mockReturnValue({
                from: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                order: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue({
                    data: [mockPayment]
                })
            });

            // Payment should remain pending due to insufficient amount
            database.updatePaymentStatus.mockResolvedValue(false);

            await paymentMonitor.checkPendingPayments();

            // Should not update to confirmed due to validation failure
            expect(database.updatePaymentStatus).not.toHaveBeenCalledWith(
                mockPayment.reference,
                'confirmed',
                expect.any(String)
            );
        });

        it('should handle network errors during SOL payment monitoring', async () => {
            const mockPayment = {
                id: 'payment-network-error-123',
                reference: testReferenceKeypair.publicKey.toString(),
                amount: '1.0',
                currency: 'SOL',
                spl_token_mint: null,
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            };

            // Mock network error
            findReference.mockRejectedValue(new Error('Network connection failed'));

            database.getClient.mockReturnValue({
                from: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                order: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue({
                    data: [mockPayment]
                })
            });

            // Should handle error gracefully without crashing
            await expect(paymentMonitor.checkPendingPayments()).resolves.not.toThrow();

            // Should log error but not update payment status
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('Error checking payment confirmation'),
                expect.any(Object)
            );
        });
    });

    describe('USDC Payment Regression Testing', () => {
        it('should continue to process USDC payments correctly (regression test)', async () => {
            const usdcPaymentData = {
                amount: 100,
                label: 'Test USDC Payment',
                message: 'Regression test for USDC',
                web3AuthUserId: testUser.web3auth_user_id,
                chain: 'solana',
                splToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' // USDC mint
            };

            const mockUSDCPayment = {
                id: 'usdc-payment-123',
                reference: testReferenceKeypair.publicKey.toString(),
                web3auth_user_id: testUser.web3auth_user_id,
                amount: '100',
                currency: 'USDC',
                spl_token_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            };

            database.createPayment.mockResolvedValue(mockUSDCPayment);

            // Create USDC payment
            const createResponse = await request(app)
                .post('/payments/create')
                .send(usdcPaymentData)
                .expect(200);

            expect(createResponse.body.success).toBe(true);
            expect(createResponse.body.payment.currency).toBe('USDC');
            expect(createResponse.body.payment.spl_token_mint).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

            // Mock successful USDC transaction validation
            const mockUSDCTransaction = {
                transaction: {
                    message: {
                        version: 'legacy',
                        accountKeys: [
                            testMerchantWallet,
                            new PublicKey(testUser.solana_address),
                            testReferenceKeypair.publicKey,
                            new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), // USDC mint
                            new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') // Token program
                        ]
                    }
                },
                meta: {
                    err: null,
                    preTokenBalances: [
                        { accountIndex: 0, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { amount: '50000000', decimals: 6, uiAmount: 50 } }
                    ],
                    postTokenBalances: [
                        { accountIndex: 0, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { amount: '150000000', decimals: 6, uiAmount: 150 } }
                    ]
                }
            };

            findReference.mockResolvedValue('usdc-signature-123');
            mockConnection.getTransaction.mockResolvedValue(mockUSDCTransaction);

            // Mock validateTransfer for USDC (existing Solana Pay validation)
            validateTransfer.mockResolvedValue(undefined); // No error means valid

            database.getClient.mockReturnValue({
                from: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                order: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue({
                    data: [mockUSDCPayment]
                })
            });

            // Run monitoring
            await paymentMonitor.checkPendingPayments();

            // Verify USDC payment was processed using existing validation
            expect(validateTransfer).toHaveBeenCalledWith(
                mockConnection,
                'usdc-signature-123',
                expect.objectContaining({
                    recipient: testMerchantWallet,
                    amount: new BigNumber(100),
                    splToken: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
                    reference: testReferenceKeypair.publicKey
                })
            );

            expect(database.updatePaymentStatus).toHaveBeenCalledWith(
                mockUSDCPayment.reference,
                'confirmed',
                'usdc-signature-123'
            );
        });

        it('should handle mixed SOL and USDC payments in the same monitoring cycle', async () => {
            const solPayment = {
                id: 'mixed-sol-123',
                reference: 'sol-ref-123',
                amount: '1.0',
                currency: 'SOL',
                spl_token_mint: null,
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            };

            const usdcPayment = {
                id: 'mixed-usdc-123',
                reference: 'usdc-ref-123',
                amount: '50',
                currency: 'USDC',
                spl_token_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            };

            // Mock both payments in pending state
            database.getClient.mockReturnValue({
                from: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                order: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue({
                    data: [solPayment, usdcPayment]
                })
            });

            // Mock successful transactions for both
            findReference
                .mockResolvedValueOnce('sol-mixed-sig-123')
                .mockResolvedValueOnce('usdc-mixed-sig-123');

            const mockSOLTransaction = {
                transaction: {
                    message: {
                        version: 'legacy',
                        accountKeys: [testMerchantWallet, new PublicKey(testUser.solana_address), new PublicKey('sol-ref-123')]
                    }
                },
                meta: {
                    err: null,
                    preBalances: [1000000000, 2000000000, 0],
                    postBalances: [2000000000, 1000000000, 0]
                }
            };

            const mockUSDCTransaction = {
                transaction: {
                    message: {
                        version: 'legacy',
                        accountKeys: [testMerchantWallet, new PublicKey(testUser.solana_address), new PublicKey('usdc-ref-123')]
                    }
                },
                meta: {
                    err: null,
                    preTokenBalances: [{ accountIndex: 0, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { amount: '100000000', decimals: 6, uiAmount: 100 } }],
                    postTokenBalances: [{ accountIndex: 0, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', uiTokenAmount: { amount: '150000000', decimals: 6, uiAmount: 150 } }]
                }
            };

            mockConnection.getTransaction
                .mockResolvedValueOnce(mockSOLTransaction)
                .mockResolvedValueOnce(mockUSDCTransaction);

            validateTransfer.mockResolvedValue(undefined); // USDC validation passes

            // Run monitoring
            await paymentMonitor.checkPendingPayments();

            // Both payments should be confirmed
            expect(database.updatePaymentStatus).toHaveBeenCalledWith('sol-ref-123', 'confirmed', 'sol-mixed-sig-123');
            expect(database.updatePaymentStatus).toHaveBeenCalledWith('usdc-ref-123', 'confirmed', 'usdc-mixed-sig-123');
        });
    });

    describe('Error Handling and Edge Cases', () => {
        it('should handle FindReferenceError for SOL payments', async () => {
            const mockPayment = {
                id: 'payment-not-found-123',
                reference: testReferenceKeypair.publicKey.toString(),
                amount: '1.0',
                currency: 'SOL',
                spl_token_mint: null,
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            };

            findReference.mockRejectedValue(new FindReferenceError('Transaction not found'));

            database.getClient.mockReturnValue({
                from: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                order: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue({
                    data: [mockPayment]
                })
            });

            await paymentMonitor.checkPendingPayments();

            // Should log the not found status but not crash
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('Payment transaction not found yet'),
                expect.any(Object)
            );

            // Should not update payment status
            expect(database.updatePaymentStatus).not.toHaveBeenCalled();
        });

        it('should handle SOL payments with micro amounts and fee tolerance', async () => {
            const microPayment = {
                id: 'micro-payment-123',
                reference: testReferenceKeypair.publicKey.toString(),
                amount: '0.000001', // 1000 lamports
                currency: 'SOL',
                spl_token_mint: null,
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            };

            const mockMicroTransaction = {
                transaction: {
                    message: {
                        version: 'legacy',
                        accountKeys: [testMerchantWallet, new PublicKey(testUser.solana_address), testReferenceKeypair.publicKey]
                    }
                },
                meta: {
                    err: null,
                    preBalances: [1000000000, 1000000000, 0],
                    postBalances: [1000000999, 999999001, 0], // 999 lamports transfer (within tolerance)
                    fee: 5000
                }
            };

            findReference.mockResolvedValue('micro-sig-123');
            mockConnection.getTransaction.mockResolvedValue(mockMicroTransaction);

            database.getClient.mockReturnValue({
                from: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                order: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue({
                    data: [microPayment]
                })
            });

            await paymentMonitor.checkPendingPayments();

            // Should accept micro payment within tolerance
            expect(database.updatePaymentStatus).toHaveBeenCalledWith(
                microPayment.reference,
                'confirmed',
                'micro-sig-123'
            );
        });

        it('should handle transaction parsing errors gracefully', async () => {
            const mockPayment = {
                id: 'parsing-error-123',
                reference: testReferenceKeypair.publicKey.toString(),
                amount: '1.0',
                currency: 'SOL',
                spl_token_mint: null,
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            };

            findReference.mockResolvedValue('parsing-error-sig-123');

            // Mock malformed transaction
            mockConnection.getTransaction.mockResolvedValue({
                transaction: {
                    message: {
                        version: 'legacy'
                        // Missing accountKeys - should cause parsing error
                    }
                },
                meta: null
            });

            database.getClient.mockReturnValue({
                from: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                order: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue({
                    data: [mockPayment]
                })
            });

            await paymentMonitor.checkPendingPayments();

            // Should handle parsing error gracefully
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('Error validating SOL payment'),
                expect.any(Object)
            );

            // Should not update payment status due to error
            expect(database.updatePaymentStatus).not.toHaveBeenCalledWith(
                mockPayment.reference,
                'confirmed',
                expect.any(String)
            );
        });
    });
});