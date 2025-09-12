/**
 * Final SOL Payment Integration Tests
 * 
 * This test suite validates the complete end-to-end SOL payment flow
 * and ensures USDC payments continue to work (regression testing).
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

describe('SOL Payment Final Integration Tests', () => {
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

    describe('Complete SOL Payment Creation and Monitoring Cycle', () => {
        it('should process SOL payment from creation to confirmation', async () => {
            // Test data
            const solPayment = {
                id: 'integration-sol-123',
                reference: testReferenceKeypair.publicKey.toString(),
                amount: '1.5',
                currency: 'SOL',
                spl_token_mint: null,
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            };

            // Step 1: Mock pending payment in database
            database.getClient.mockReturnValue({
                from: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                order: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue({ data: [solPayment] })
            });

            // Step 2: Mock successful transaction found
            const mockSignature = 'integration-sol-signature-123';
            findReference.mockResolvedValue(mockSignature);

            // Step 3: Mock valid SOL transaction with correct amount
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
                    preBalances: [1000000000, 2500000000, 0], // 1 SOL, 2.5 SOL, 0
                    postBalances: [2500000000, 1000000000, 0], // 2.5 SOL, 1 SOL, 0 (1.5 SOL transfer)
                    fee: 5000
                }
            };

            mockConnection.getTransaction.mockResolvedValue(mockTransaction);
            database.updatePaymentStatus.mockResolvedValue(true);

            // Step 4: Run payment monitoring
            await paymentMonitor.checkPendingPayments();

            // Step 5: Verify complete flow
            expect(findReference).toHaveBeenCalledWith(
                mockConnection,
                testReferenceKeypair.publicKey,
                expect.any(Object)
            );

            expect(database.updatePaymentStatus).toHaveBeenCalledWith(
                solPayment.reference,
                'confirmed',
                mockSignature
            );
        });

        it('should handle SOL payment with versioned transactions', async () => {
            const solPayment = {
                id: 'versioned-sol-123',
                reference: testReferenceKeypair.publicKey.toString(),
                amount: '2.0',
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

            findReference.mockResolvedValue('versioned-signature-123');

            // Mock versioned transaction
            const mockVersionedTransaction = {
                transaction: {
                    message: {
                        version: 0,
                        getAccountKeys: jest.fn().mockReturnValue([
                            testMerchantWallet,
                            testUserWallet,
                            testReferenceKeypair.publicKey
                        ])
                    }
                },
                meta: {
                    err: null,
                    preBalances: [1000000000, 3000000000, 0],
                    postBalances: [3000000000, 1000000000, 0], // 2.0 SOL transfer
                    fee: 5000
                }
            };

            mockConnection.getTransaction.mockResolvedValue(mockVersionedTransaction);
            database.updatePaymentStatus.mockResolvedValue(true);

            await paymentMonitor.checkPendingPayments();

            expect(mockVersionedTransaction.transaction.message.getAccountKeys).toHaveBeenCalled();
            expect(database.updatePaymentStatus).toHaveBeenCalledWith(
                solPayment.reference,
                'confirmed',
                'versioned-signature-123'
            );
        });
    });

    describe('SOL Payment Status Updates Work Correctly', () => {
        it('should correctly transition from pending to confirmed', async () => {
            const solPayment = {
                id: 'status-update-123',
                reference: testReferenceKeypair.publicKey.toString(),
                amount: '0.5',
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

            findReference.mockResolvedValue('status-update-signature-123');

            const mockTransaction = {
                transaction: {
                    message: {
                        version: 'legacy',
                        accountKeys: [testMerchantWallet, testUserWallet, testReferenceKeypair.publicKey]
                    }
                },
                meta: {
                    err: null,
                    preBalances: [500000000, 1000000000, 0],
                    postBalances: [1000000000, 500000000, 0], // 0.5 SOL transfer
                    fee: 5000
                }
            };

            mockConnection.getTransaction.mockResolvedValue(mockTransaction);
            database.updatePaymentStatus.mockResolvedValue(true);

            await paymentMonitor.checkPendingPayments();

            expect(database.updatePaymentStatus).toHaveBeenCalledWith(
                solPayment.reference,
                'confirmed',
                'status-update-signature-123'
            );
        });

        it('should handle payment validation failures gracefully', async () => {
            const solPayment = {
                id: 'validation-fail-123',
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

            findReference.mockResolvedValue('validation-fail-signature-123');

            // Mock transaction with insufficient amount
            const mockInsufficientTransaction = {
                transaction: {
                    message: {
                        version: 'legacy',
                        accountKeys: [testMerchantWallet, testUserWallet, testReferenceKeypair.publicKey]
                    }
                },
                meta: {
                    err: null,
                    preBalances: [1000000000, 2000000000, 0],
                    postBalances: [1400000000, 1600000000, 0], // Only 0.4 SOL transfer (insufficient)
                    fee: 5000
                }
            };

            mockConnection.getTransaction.mockResolvedValue(mockInsufficientTransaction);

            await paymentMonitor.checkPendingPayments();

            // Should not update to confirmed due to validation failure
            expect(database.updatePaymentStatus).not.toHaveBeenCalledWith(
                solPayment.reference,
                'confirmed',
                expect.any(String)
            );
        });
    });

    describe('USDC Payments Continue Working (Regression Testing)', () => {
        it('should process USDC payments using existing validation', async () => {
            const usdcPayment = {
                id: 'usdc-regression-123',
                reference: testReferenceKeypair.publicKey.toString(),
                amount: '100',
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

            findReference.mockResolvedValue('usdc-regression-signature-123');
            validateTransfer.mockResolvedValue(undefined); // No error = valid
            database.updatePaymentStatus.mockResolvedValue(true);

            await paymentMonitor.checkPendingPayments();

            // Should use existing validateTransfer for USDC
            expect(validateTransfer).toHaveBeenCalledWith(
                mockConnection,
                'usdc-regression-signature-123',
                expect.objectContaining({
                    recipient: testMerchantWallet,
                    amount: new BigNumber(100),
                    splToken: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
                    reference: testReferenceKeypair.publicKey
                }),
                expect.any(Object)
            );

            expect(database.updatePaymentStatus).toHaveBeenCalledWith(
                usdcPayment.reference,
                'confirmed',
                'usdc-regression-signature-123'
            );
        });

        it('should handle both SOL and USDC payments in same cycle', async () => {
            const solRef = Keypair.generate();
            const usdcRef = Keypair.generate();

            const solPayment = {
                id: 'mixed-sol-123',
                reference: solRef.publicKey.toString(),
                amount: '1.0',
                currency: 'SOL',
                spl_token_mint: null,
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            };

            const usdcPayment = {
                id: 'mixed-usdc-123',
                reference: usdcRef.publicKey.toString(),
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
                limit: jest.fn().mockResolvedValue({ data: [solPayment, usdcPayment] })
            });

            findReference
                .mockResolvedValueOnce('mixed-sol-signature-123')
                .mockResolvedValueOnce('mixed-usdc-signature-123');

            // Mock SOL transaction
            const mockSOLTransaction = {
                transaction: {
                    message: {
                        version: 'legacy',
                        accountKeys: [testMerchantWallet, testUserWallet, solRef.publicKey]
                    }
                },
                meta: {
                    err: null,
                    preBalances: [1000000000, 2000000000, 0],
                    postBalances: [2000000000, 1000000000, 0],
                    fee: 5000
                }
            };

            mockConnection.getTransaction.mockResolvedValueOnce(mockSOLTransaction);
            validateTransfer.mockResolvedValue(undefined); // USDC validation passes
            database.updatePaymentStatus.mockResolvedValue(true);

            await paymentMonitor.checkPendingPayments();

            // Both payments should be confirmed
            expect(database.updatePaymentStatus).toHaveBeenCalledWith(
                solPayment.reference,
                'confirmed',
                'mixed-sol-signature-123'
            );
            expect(database.updatePaymentStatus).toHaveBeenCalledWith(
                usdcPayment.reference,
                'confirmed',
                'mixed-usdc-signature-123'
            );
        });
    });

    describe('Payment Type Detection and Processing', () => {
        it('should correctly identify and process different payment types', () => {
            // Test SOL payment identification
            const solPayment = {
                currency: 'SOL',
                spl_token_mint: null,
                amount: '1.5'
            };

            const solPaymentType = paymentMonitor.getPaymentTypeInfo(solPayment);
            expect(solPaymentType.type).toBe('SOL');
            expect(solPaymentType.isSOL).toBe(true);
            expect(solPaymentType.isSPLToken).toBe(false);

            // Test USDC payment identification
            const usdcPayment = {
                currency: 'USDC',
                spl_token_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                amount: '100'
            };

            const usdcPaymentType = paymentMonitor.getPaymentTypeInfo(usdcPayment);
            expect(usdcPaymentType.type).toBe('SPL_TOKEN');
            expect(usdcPaymentType.isSOL).toBe(false);
            expect(usdcPaymentType.isSPLToken).toBe(true);
        });

        it('should handle transaction parsing for different formats', () => {
            // Test legacy transaction parsing
            const legacyMessage = {
                version: 'legacy',
                accountKeys: [testMerchantWallet, testUserWallet, testReferenceKeypair.publicKey]
            };

            const legacyKeys = paymentMonitor.getTransactionAccountKeys(legacyMessage);
            expect(legacyKeys).toEqual([testMerchantWallet, testUserWallet, testReferenceKeypair.publicKey]);

            // Test versioned transaction parsing
            const mockAccountKeys = [testMerchantWallet, testUserWallet, testReferenceKeypair.publicKey];
            const versionedMessage = {
                version: 0,
                getAccountKeys: jest.fn().mockReturnValue(mockAccountKeys)
            };

            const versionedKeys = paymentMonitor.getTransactionAccountKeys(versionedMessage);
            expect(versionedKeys).toEqual(mockAccountKeys);
            expect(versionedMessage.getAccountKeys).toHaveBeenCalled();
        });
    });

    describe('Error Handling and Recovery', () => {
        it('should handle FindReferenceError (transaction not found)', async () => {
            const solPayment = {
                id: 'not-found-123',
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

            findReference.mockRejectedValue(new FindReferenceError('Transaction not found'));

            await expect(paymentMonitor.checkPendingPayments()).resolves.not.toThrow();
            expect(database.updatePaymentStatus).not.toHaveBeenCalled();
        });

        it('should handle network errors during monitoring', async () => {
            const solPayment = {
                id: 'network-error-123',
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

            findReference.mockRejectedValue(new Error('Network connection failed'));

            await expect(paymentMonitor.checkPendingPayments()).resolves.not.toThrow();
        });

        it('should handle malformed transaction data', async () => {
            const solPayment = {
                id: 'malformed-123',
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

            findReference.mockResolvedValue('malformed-signature-123');

            // Mock malformed transaction (missing required fields)
            mockConnection.getTransaction.mockResolvedValue({
                transaction: {
                    message: {
                        version: 'legacy'
                        // Missing accountKeys
                    }
                },
                meta: null
            });

            await expect(paymentMonitor.checkPendingPayments()).resolves.not.toThrow();
            expect(database.updatePaymentStatus).not.toHaveBeenCalledWith(
                solPayment.reference,
                'confirmed',
                expect.any(String)
            );
        });
    });
});