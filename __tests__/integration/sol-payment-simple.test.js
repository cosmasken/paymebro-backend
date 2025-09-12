/**
 * Simple SOL Payment Integration Tests
 * 
 * This test suite focuses on the core SOL payment monitoring functionality
 * and ensures that SOL payments work correctly alongside USDC payments.
 */

const paymentMonitor = require('../../src/services/paymentMonitor');
const database = require('../../src/services/database');
const { PublicKey, Keypair } = require('@solana/web3.js');
const { findReference, validateTransfer, FindReferenceError } = require('@solana/pay');
const BigNumber = require('bignumber.js');

// Mock all dependencies
jest.mock('../../src/services/database');
jest.mock('../../src/utils/logger');
jest.mock('../../src/services/websocket');
jest.mock('../../src/services/emailService');
jest.mock('../../src/services/solana');
jest.mock('@solana/pay');

describe('SOL Payment Integration Tests - Core Functionality', () => {
    let mockConnection;
    let testMerchantWallet;
    let testUserWallet;
    let testReferenceKeypair;

    beforeAll(() => {
        // Use valid Solana addresses
        testMerchantWallet = new PublicKey('GDBPQ6G7k9xMFcmz2GqEgmcesC6DRzeWQPfRPk1hQNBo');
        testUserWallet = new PublicKey('HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH');
        testReferenceKeypair = Keypair.generate();
    });

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock Solana connection
        mockConnection = {
            getTransaction: jest.fn(),
            getSignatureStatus: jest.fn(),
            getAccountInfo: jest.fn(),
            getBalance: jest.fn()
        };

        // Mock payment monitor connection
        paymentMonitor.getConnection = jest.fn().mockResolvedValue(mockConnection);
    });

    describe('SOL Payment Type Detection', () => {
        it('should correctly identify SOL payments', () => {
            const solPayment = {
                currency: 'SOL',
                spl_token_mint: null,
                amount: '1.5'
            };

            const paymentType = paymentMonitor.getPaymentTypeInfo(solPayment);

            expect(paymentType.type).toBe('SOL');
            expect(paymentType.isSOL).toBe(true);
            expect(paymentType.isSPLToken).toBe(false);
            expect(paymentType.currency).toBe('SOL');
            expect(paymentType.tokenMint).toBeNull();
        });

        it('should correctly identify USDC payments', () => {
            const usdcPayment = {
                currency: 'USDC',
                spl_token_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                amount: '100'
            };

            const paymentType = paymentMonitor.getPaymentTypeInfo(usdcPayment);

            expect(paymentType.type).toBe('SPL_TOKEN');
            expect(paymentType.isSOL).toBe(false);
            expect(paymentType.isSPLToken).toBe(true);
            expect(paymentType.currency).toBe('USDC');
            expect(paymentType.tokenMint).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
        });
    });

    describe('SOL Payment Monitoring Flow', () => {
        it('should handle SOL payment not found (pending state)', async () => {
            const solPayment = {
                id: 'sol-pending-123',
                reference: testReferenceKeypair.publicKey.toString(),
                amount: '1.0',
                currency: 'SOL',
                spl_token_mint: null,
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            };

            // Mock database query
            database.getClient.mockReturnValue({
                from: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                order: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue({ data: [solPayment] })
            });

            // Mock transaction not found
            findReference.mockRejectedValue(new FindReferenceError('Transaction not found'));

            // Should complete without errors
            await expect(paymentMonitor.checkPendingPayments()).resolves.not.toThrow();

            // Should attempt to find reference
            expect(findReference).toHaveBeenCalledWith(
                mockConnection,
                testReferenceKeypair.publicKey,
                expect.any(Object)
            );

            // Should not update payment status (still pending)
            expect(database.updatePaymentStatus).not.toHaveBeenCalled();
        });

        it('should successfully confirm SOL payment when transaction is found', async () => {
            const solPayment = {
                id: 'sol-confirm-123',
                reference: testReferenceKeypair.publicKey.toString(),
                amount: '1.0',
                currency: 'SOL',
                spl_token_mint: null,
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            };

            database.getClient.mockReturnValue({
                from: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                order: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue({ data: [solPayment] })
            });

            // Mock successful transaction found
            const mockSignature = 'sol-confirmed-signature-123';
            findReference.mockResolvedValue(mockSignature);

            // Mock valid SOL transaction
            const mockTransaction = {
                transaction: {
                    message: {
                        version: 'legacy',
                        accountKeys: [
                            testMerchantWallet,
                            testUserWallet,
                            testReferenceKeypair.publicKey
                        ]
                    }
                },
                meta: {
                    err: null,
                    preBalances: [1000000000, 2000000000, 0], // 1 SOL, 2 SOL, 0
                    postBalances: [2000000000, 1000000000, 0], // 2 SOL, 1 SOL, 0 (1 SOL transfer)
                    fee: 5000
                }
            };

            mockConnection.getTransaction.mockResolvedValue(mockTransaction);
            database.updatePaymentStatus.mockResolvedValue(true);

            await paymentMonitor.checkPendingPayments();

            // Should find and validate transaction
            expect(findReference).toHaveBeenCalled();
            expect(mockConnection.getTransaction).toHaveBeenCalledWith(
                mockSignature,
                expect.objectContaining({
                    commitment: 'confirmed',
                    maxSupportedTransactionVersion: 0
                })
            );

            // Should update payment to confirmed
            expect(database.updatePaymentStatus).toHaveBeenCalledWith(
                solPayment.reference,
                'confirmed',
                mockSignature
            );
        });

        it('should continue to handle USDC payments correctly (regression test)', async () => {
            const usdcPayment = {
                id: 'usdc-regression-123',
                reference: testReferenceKeypair.publicKey.toString(),
                amount: '50',
                currency: 'USDC',
                spl_token_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            };

            database.getClient.mockReturnValue({
                from: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                order: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue({ data: [usdcPayment] })
            });

            const mockSignature = 'usdc-confirmed-signature-123';
            findReference.mockResolvedValue(mockSignature);

            // Mock successful USDC validation (existing Solana Pay validation)
            validateTransfer.mockResolvedValue(undefined); // No error = valid

            database.updatePaymentStatus.mockResolvedValue(true);

            await paymentMonitor.checkPendingPayments();

            // Should use existing validateTransfer for USDC
            expect(validateTransfer).toHaveBeenCalledWith(
                mockConnection,
                mockSignature,
                expect.objectContaining({
                    recipient: testMerchantWallet,
                    amount: new BigNumber(50),
                    splToken: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
                    reference: testReferenceKeypair.publicKey
                }),
                expect.any(Object)
            );

            expect(database.updatePaymentStatus).toHaveBeenCalledWith(
                usdcPayment.reference,
                'confirmed',
                mockSignature
            );
        });

        it('should handle mixed SOL and USDC payments in same monitoring cycle', async () => {
            const solPayment = {
                id: 'mixed-sol-123',
                reference: 'sol-ref-mixed-123',
                amount: '1.0',
                currency: 'SOL',
                spl_token_mint: null,
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            };

            const usdcPayment = {
                id: 'mixed-usdc-123',
                reference: 'usdc-ref-mixed-123',
                amount: '25',
                currency: 'USDC',
                spl_token_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            };

            database.getClient.mockReturnValue({
                from: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                order: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue({ data: [solPayment, usdcPayment] })
            });

            // Mock successful transactions for both
            findReference
                .mockResolvedValueOnce('sol-mixed-sig-123')
                .mockResolvedValueOnce('usdc-mixed-sig-123');

            // Mock SOL transaction
            const mockSOLTransaction = {
                transaction: {
                    message: {
                        version: 'legacy',
                        accountKeys: [testMerchantWallet, testUserWallet, new PublicKey('sol-ref-mixed-123')]
                    }
                },
                meta: {
                    err: null,
                    preBalances: [1000000000, 2000000000, 0],
                    postBalances: [2000000000, 1000000000, 0],
                    fee: 5000
                }
            };

            mockConnection.getTransaction
                .mockResolvedValueOnce(mockSOLTransaction)
                .mockResolvedValueOnce({}); // USDC transaction (not used in validateTransfer)

            validateTransfer.mockResolvedValue(undefined); // USDC validation passes
            database.updatePaymentStatus.mockResolvedValue(true);

            await paymentMonitor.checkPendingPayments();

            // Both payments should be processed
            expect(findReference).toHaveBeenCalledTimes(2);
            expect(database.updatePaymentStatus).toHaveBeenCalledTimes(2);

            // SOL payment confirmed
            expect(database.updatePaymentStatus).toHaveBeenCalledWith(
                'sol-ref-mixed-123',
                'confirmed',
                'sol-mixed-sig-123'
            );

            // USDC payment confirmed
            expect(database.updatePaymentStatus).toHaveBeenCalledWith(
                'usdc-ref-mixed-123',
                'confirmed',
                'usdc-mixed-sig-123'
            );
        });
    });

    describe('Error Handling and Edge Cases', () => {
        it('should handle network errors gracefully', async () => {
            const solPayment = {
                id: 'sol-network-error-123',
                reference: testReferenceKeypair.publicKey.toString(),
                amount: '1.0',
                currency: 'SOL',
                status: 'pending'
            };

            database.getClient.mockReturnValue({
                from: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                order: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue({ data: [solPayment] })
            });

            // Mock network error
            findReference.mockRejectedValue(new Error('Network connection failed'));

            // Should handle error without crashing
            await expect(paymentMonitor.checkPendingPayments()).resolves.not.toThrow();

            // Should not update payment status due to error
            expect(database.updatePaymentStatus).not.toHaveBeenCalled();
        });

        it('should handle database errors gracefully', async () => {
            const solPayment = {
                id: 'sol-db-error-123',
                reference: testReferenceKeypair.publicKey.toString(),
                amount: '1.0',
                currency: 'SOL',
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            };

            database.getClient.mockReturnValue({
                from: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                order: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue({ data: [solPayment] })
            });

            findReference.mockResolvedValue('db-error-sig-123');

            const mockTransaction = {
                transaction: {
                    message: {
                        version: 'legacy',
                        accountKeys: [testMerchantWallet, testUserWallet, testReferenceKeypair.publicKey]
                    }
                },
                meta: {
                    err: null,
                    preBalances: [1000000000, 2000000000, 0],
                    postBalances: [2000000000, 1000000000, 0],
                    fee: 5000
                }
            };

            mockConnection.getTransaction.mockResolvedValue(mockTransaction);

            // Mock database update failure
            database.updatePaymentStatus.mockRejectedValue(new Error('Database connection lost'));

            // Should handle database error without crashing
            await expect(paymentMonitor.checkPendingPayments()).resolves.not.toThrow();
        });

        it('should handle empty pending payments list', async () => {
            database.getClient.mockReturnValue({
                from: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                order: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue({ data: [] })
            });

            await expect(paymentMonitor.checkPendingPayments()).resolves.not.toThrow();

            // Should not attempt to find any references
            expect(findReference).not.toHaveBeenCalled();
            expect(database.updatePaymentStatus).not.toHaveBeenCalled();
        });
    });

    describe('Transaction Parsing and Validation', () => {
        it('should handle legacy transaction format correctly', () => {
            const legacyMessage = {
                version: 'legacy',
                accountKeys: [testMerchantWallet, testUserWallet, testReferenceKeypair.publicKey]
            };

            const accountKeys = paymentMonitor.getTransactionAccountKeys(legacyMessage);

            expect(accountKeys).toEqual([testMerchantWallet, testUserWallet, testReferenceKeypair.publicKey]);
        });

        it('should handle versioned transaction format correctly', () => {
            const mockAccountKeys = [testMerchantWallet, testUserWallet, testReferenceKeypair.publicKey];
            const versionedMessage = {
                version: 0,
                getAccountKeys: jest.fn().mockReturnValue(mockAccountKeys)
            };

            const accountKeys = paymentMonitor.getTransactionAccountKeys(versionedMessage);

            expect(accountKeys).toEqual(mockAccountKeys);
            expect(versionedMessage.getAccountKeys).toHaveBeenCalledTimes(1);
        });

        it('should handle transaction parsing errors', () => {
            const invalidMessage = {
                version: 'legacy'
                // Missing accountKeys
            };

            expect(() => {
                paymentMonitor.getTransactionAccountKeys(invalidMessage);
            }).toThrow('Legacy transaction missing accountKeys property');
        });
    });
});