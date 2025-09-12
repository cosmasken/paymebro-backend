const request = require('supertest');
const express = require('express');
const { PublicKey, Keypair } = require('@solana/web3.js');
const BigNumber = require('bignumber.js');
const database = require('../../src/services/database');
const paymentMonitor = require('../../src/services/paymentMonitor');
const { createPayment, getPayment } = require('../../src/controllers/payments');
const { asyncHandler } = require('../../src/middleware/errorHandler');

// Mock dependencies
jest.mock('../../src/services/database');
jest.mock('../../src/utils/logger');
jest.mock('../../src/services/websocket');
jest.mock('../../src/services/emailService');
jest.mock('../../src/services/solana');
jest.mock('@solana/pay');

const { findReference, validateTransfer, FindReferenceError } = require('@solana/pay');

describe('SOL Payment Basic Integration Tests', () => {
    let app;
    let testUser;
    let testMerchantWallet;
    let testReferenceKeypair;
    let mockConnection;

    beforeAll(() => {
        // Create test app
        app = express();
        app.use(express.json());

        // Add payment routes
        app.post('/payments/create', asyncHandler(createPayment));
        app.get('/payments/:reference', asyncHandler(getPayment));

        // Setup test data with valid Solana addresses
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

        // Mock connection
        mockConnection = {
            getTransaction: jest.fn(),
            getSignatureStatus: jest.fn(),
            getAccountInfo: jest.fn(),
            getBalance: jest.fn()
        };
    });

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup default mocks
        database.getUserById.mockResolvedValue(testUser);
        database.getUserDefaultAddress.mockResolvedValue({
            address: testMerchantWallet.toString(),
            network: 'solana'
        });

        paymentMonitor.getConnection = jest.fn().mockResolvedValue(mockConnection);
    });

    describe('SOL Payment Creation', () => {
        it('should create a SOL payment successfully', async () => {
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

            const response = await request(app)
                .post('/payments/create')
                .send(paymentData)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.payment).toBeDefined();
            expect(response.body.payment.currency).toBe('SOL');
            expect(response.body.payment.status).toBe('pending');
            expect(response.body.payment.spl_token_mint).toBeNull();
        });

        it('should create USDC payment for regression testing', async () => {
            const usdcPaymentData = {
                amount: 100,
                label: 'Test USDC Payment',
                message: 'Regression test for USDC',
                web3AuthUserId: testUser.web3auth_user_id,
                chain: 'solana',
                splToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
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

            const response = await request(app)
                .post('/payments/create')
                .send(usdcPaymentData)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.payment.currency).toBe('USDC');
            expect(response.body.payment.spl_token_mint).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
        });
    });

    describe('SOL Payment Status Updates', () => {
        it('should retrieve payment status correctly', async () => {
            const mockPayment = {
                id: 'payment-status-123',
                reference: testReferenceKeypair.publicKey.toString(),
                amount: '1.0',
                currency: 'SOL',
                spl_token_mint: null,
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            };

            database.getPayment.mockResolvedValue(mockPayment);

            const response = await request(app)
                .get(`/payments/${mockPayment.reference}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.payment.status).toBe('pending');
            expect(response.body.payment.currency).toBe('SOL');
        });

        it('should handle payment not found', async () => {
            database.getPayment.mockResolvedValue(null);

            const response = await request(app)
                .get('/payments/nonexistent-reference')
                .expect(404);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('Payment not found');
        });
    });

    describe('Payment Monitoring Basic Flow', () => {
        it('should process SOL payment monitoring without errors', async () => {
            const mockPayment = {
                id: 'monitor-payment-123',
                reference: testReferenceKeypair.publicKey.toString(),
                amount: '1.0',
                currency: 'SOL',
                spl_token_mint: null,
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            };

            // Mock database query for pending payments
            database.getClient.mockReturnValue({
                from: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                order: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue({
                    data: [mockPayment]
                })
            });

            // Mock transaction not found (common case)
            findReference.mockRejectedValue(new FindReferenceError('Transaction not found'));

            // Should handle monitoring without crashing
            await expect(paymentMonitor.checkPendingPayments()).resolves.not.toThrow();

            expect(findReference).toHaveBeenCalled();
        });

        it('should handle successful SOL payment confirmation', async () => {
            const mockPayment = {
                id: 'confirm-payment-123',
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
                limit: jest.fn().mockResolvedValue({
                    data: [mockPayment]
                })
            });

            // Mock successful transaction found
            const mockSignature = 'test-signature-123';
            findReference.mockResolvedValue(mockSignature);

            // Mock transaction details
            const mockTransaction = {
                transaction: {
                    message: {
                        version: 'legacy',
                        accountKeys: [
                            testMerchantWallet,
                            new PublicKey(testUser.solana_address),
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

            expect(findReference).toHaveBeenCalled();
            expect(mockConnection.getTransaction).toHaveBeenCalledWith(mockSignature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0
            });
            expect(database.updatePaymentStatus).toHaveBeenCalledWith(
                mockPayment.reference,
                'confirmed',
                mockSignature
            );
        });

        it('should handle USDC payment monitoring (regression test)', async () => {
            const mockUSDCPayment = {
                id: 'usdc-monitor-123',
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
                limit: jest.fn().mockResolvedValue({
                    data: [mockUSDCPayment]
                })
            });

            findReference.mockResolvedValue('usdc-signature-123');
            validateTransfer.mockResolvedValue(undefined); // No error means valid

            await paymentMonitor.checkPendingPayments();

            expect(validateTransfer).toHaveBeenCalledWith(
                mockConnection,
                'usdc-signature-123',
                expect.objectContaining({
                    recipient: testMerchantWallet,
                    amount: new BigNumber(50),
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
    });

    describe('Error Handling', () => {
        it('should handle user not found during payment creation', async () => {
            database.getUserById.mockResolvedValue(null);

            const paymentData = {
                amount: 1.0,
                label: 'Test Payment',
                web3AuthUserId: 'nonexistent-user',
                chain: 'solana'
            };

            const response = await request(app)
                .post('/payments/create')
                .send(paymentData)
                .expect(400);

            expect(response.body.success).toBe(false);
            expect(response.body.error).toBe('User not found. Please complete onboarding first.');
        });

        it('should handle network errors during monitoring', async () => {
            const mockPayment = {
                id: 'error-payment-123',
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
                limit: jest.fn().mockResolvedValue({
                    data: [mockPayment]
                })
            });

            // Mock network error
            findReference.mockRejectedValue(new Error('Network connection failed'));

            // Should handle error gracefully
            await expect(paymentMonitor.checkPendingPayments()).resolves.not.toThrow();
        });
    });
});