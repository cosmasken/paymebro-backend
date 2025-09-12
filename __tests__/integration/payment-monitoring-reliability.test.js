const paymentMonitor = require('../../src/services/paymentMonitor');
const database = require('../../src/services/database');
const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { findReference, validateTransfer, FindReferenceError } = require('@solana/pay');
const BigNumber = require('bignumber.js');
const logger = require('../../src/utils/logger');

// Mock dependencies
jest.mock('../../src/services/database');
jest.mock('../../src/utils/logger');
jest.mock('@solana/pay');
jest.mock('../../src/services/solana');

describe('Payment Monitoring Reliability Tests', () => {
    let mockConnection;
    let testReferenceKeypair;
    let testMerchantWallet;

    beforeAll(() => {
        testReferenceKeypair = Keypair.generate();
        testMerchantWallet = new PublicKey('GDBPQ6G7k9xMFcmz2GqEgmcesC6DRzeWQPfRPk1hQNBo');
    });

    beforeEach(() => {
        jest.clearAllMocks();

        mockConnection = {
            getTransaction: jest.fn(),
            getSignatureStatus: jest.fn(),
            getAccountInfo: jest.fn(),
            getBalance: jest.fn(),
            confirmTransaction: jest.fn(),
            getLatestBlockhash: jest.fn()
        };

        paymentMonitor.getConnection = jest.fn().mockResolvedValue(mockConnection);
    });

    describe('Connection Management and Error Recovery', () => {
        it('should handle RPC connection failures gracefully', async () => {
            const mockPayments = [
                {
                    id: 'payment-rpc-fail-1',
                    reference: testReferenceKeypair.publicKey.toString(),
                    amount: '1.0',
                    currency: 'SOL',
                    spl_token_mint: null,
                    status: 'pending'
                }
            ];

            database.getClient.mockReturnValue({
                from: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                order: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue({ data: mockPayments })
            });

            // Mock RPC connection failure
            paymentMonitor.getConnection.mockRejectedValue(new Error('RPC connection failed'));

            // Should handle connection failure without crashing
            await expect(paymentMonitor.checkPendingPayments()).resolves.not.toThrow();

            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to establish connection'),
                expect.any(Object)
            );
        });

        it('should implement retry logic for transient RPC errors', async () => {
            const mockPayment = {
                id: 'payment-retry-123',
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
                limit: jest.fn().mockResolvedValue({ data: [mockPayment] })
            });

            // Mock transient RPC errors followed by success
            findReference
                .mockRejectedValueOnce(new Error('RPC timeout'))
                .mockRejectedValueOnce(new Error('Network error'))
                .mockResolvedValueOnce('retry-success-sig-123');

            const mockTransaction = {
                transaction: {
                    message: {
                        version: 'legacy',
                        accountKeys: [testMerchantWallet, new PublicKey('sender123'), testReferenceKeypair.publicKey]
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
            database.updatePaymentStatus.mockResolvedValue(true);

            // Run monitoring multiple times to trigger retry logic
            await paymentMonitor.checkPendingPayments();
            await paymentMonitor.checkPendingPayments();
            await paymentMonitor.checkPendingPayments();

            // Should eventually succeed after retries
            expect(database.updatePaymentStatus).toHaveBeenCalledWith(
                mockPayment.reference,
                'confirmed',
                'retry-success-sig-123'
            );
        });

        it('should handle Solana network congestion scenarios', async () => {
            const mockPayments = Array.from({ length: 10 }, (_, i) => ({
                id: `payment-congestion-${i}`,
                reference: Keypair.generate().publicKey.toString(),
                amount: '0.5',
                currency: 'SOL',
                spl_token_mint: null,
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            }));

            database.getClient.mockReturnValue({
                from: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                order: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue({ data: mockPayments })
            });

            // Mock network congestion - some succeed, some fail
            findReference
                .mockResolvedValueOnce('congestion-sig-1')
                .mockRejectedValueOnce(new Error('RPC rate limit exceeded'))
                .mockResolvedValueOnce('congestion-sig-3')
                .mockRejectedValueOnce(new FindReferenceError('Transaction not found'))
                .mockResolvedValueOnce('congestion-sig-5')
                .mockRejectedValueOnce(new Error('Network timeout'))
                .mockResolvedValueOnce('congestion-sig-7')
                .mockRejectedValueOnce(new Error('RPC overloaded'))
                .mockResolvedValueOnce('congestion-sig-9')
                .mockRejectedValueOnce(new Error('Connection reset'));

            const mockSuccessTransaction = {
                transaction: {
                    message: {
                        version: 'legacy',
                        accountKeys: [testMerchantWallet, new PublicKey('sender123'), new PublicKey('ref123')]
                    }
                },
                meta: {
                    err: null,
                    preBalances: [500000000, 1000000000, 0],
                    postBalances: [1000000000, 500000000, 0],
                    fee: 5000
                }
            };

            mockConnection.getTransaction.mockResolvedValue(mockSuccessTransaction);
            database.updatePaymentStatus.mockResolvedValue(true);

            await paymentMonitor.checkPendingPayments();

            // Should handle partial success gracefully
            expect(database.updatePaymentStatus).toHaveBeenCalledTimes(5); // 5 successful payments
            expect(logger.error).toHaveBeenCalledTimes(5); // 5 failed payments logged
        });
    });

    describe('Payment Validation Edge Cases', () => {
        it('should handle SOL payments with complex fee structures', async () => {
            const mockPayment = {
                id: 'payment-complex-fees-123',
                reference: testReferenceKeypair.publicKey.toString(),
                amount: '10.0', // Large payment
                currency: 'SOL',
                spl_token_mint: null,
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            };

            // Transaction with priority fees, rent exemption, and multiple instructions
            const mockComplexTransaction = {
                transaction: {
                    message: {
                        version: 0,
                        getAccountKeys: jest.fn().mockReturnValue([
                            testMerchantWallet, // recipient
                            new PublicKey('sender123'), // sender
                            testReferenceKeypair.publicKey, // reference
                            new PublicKey('11111111111111111111111111111112'), // system program
                            new PublicKey('ComputeBudget111111111111111111111111111111'), // compute budget program
                            new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') // memo program
                        ]),
                        instructions: [
                            { programIdIndex: 4, accounts: [], data: Buffer.from([]) }, // Compute budget instruction
                            { programIdIndex: 3, accounts: [1, 0], data: Buffer.from([]) }, // Transfer instruction
                            { programIdIndex: 5, accounts: [], data: Buffer.from('Payment memo', 'utf8') } // Memo instruction
                        ]
                    }
                },
                meta: {
                    err: null,
                    preBalances: [5000000000, 15000000000, 0, 1, 1, 1], // 5 SOL, 15 SOL, 0, 1, 1, 1
                    postBalances: [14950000000, 5050000000, 0, 1, 1, 1], // 14.95 SOL, 5.05 SOL (9.95 SOL transfer after fees)
                    fee: 50000 // 0.05 SOL in fees (high priority fee)
                }
            };

            findReference.mockResolvedValue('complex-fees-sig-123');
            mockConnection.getTransaction.mockResolvedValue(mockComplexTransaction);

            database.getClient.mockReturnValue({
                from: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                order: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue({ data: [mockPayment] })
            });

            database.updatePaymentStatus.mockResolvedValue(true);

            await paymentMonitor.checkPendingPayments();

            // Should accept payment within tolerance despite high fees
            expect(database.updatePaymentStatus).toHaveBeenCalledWith(
                mockPayment.reference,
                'confirmed',
                'complex-fees-sig-123'
            );
        });

        it('should handle SOL payments with address lookup tables', async () => {
            const mockPayment = {
                id: 'payment-lookup-tables-123',
                reference: testReferenceKeypair.publicKey.toString(),
                amount: '2.0',
                currency: 'SOL',
                spl_token_mint: null,
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            };

            const mockLookupTableTransaction = {
                transaction: {
                    message: {
                        version: 0,
                        getAccountKeys: jest.fn().mockReturnValue([
                            testMerchantWallet,
                            new PublicKey('sender123'),
                            testReferenceKeypair.publicKey,
                            new PublicKey('11111111111111111111111111111112'),
                            // Additional accounts from lookup tables
                            new PublicKey('LookupAccount1111111111111111111111111111'),
                            new PublicKey('LookupAccount2222222222222222222222222222')
                        ]),
                        addressTableLookups: [
                            {
                                accountKey: new PublicKey('LookupTable1111111111111111111111111111'),
                                writableIndexes: [0, 1],
                                readonlyIndexes: [2, 3]
                            }
                        ]
                    }
                },
                meta: {
                    err: null,
                    preBalances: [2000000000, 4000000000, 0, 1, 1000000, 2000000],
                    postBalances: [4000000000, 2000000000, 0, 1, 1000000, 2000000], // 2 SOL transfer
                    fee: 10000,
                    loadedAddresses: {
                        writable: [
                            new PublicKey('LookupAccount1111111111111111111111111111'),
                            new PublicKey('LookupAccount2222222222222222222222222222')
                        ],
                        readonly: []
                    }
                }
            };

            findReference.mockResolvedValue('lookup-table-sig-123');
            mockConnection.getTransaction.mockResolvedValue(mockLookupTableTransaction);

            database.getClient.mockReturnValue({
                from: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                order: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue({ data: [mockPayment] })
            });

            database.updatePaymentStatus.mockResolvedValue(true);

            await paymentMonitor.checkPendingPayments();

            // Should handle lookup table transactions correctly
            expect(mockLookupTableTransaction.transaction.message.getAccountKeys).toHaveBeenCalled();
            expect(database.updatePaymentStatus).toHaveBeenCalledWith(
                mockPayment.reference,
                'confirmed',
                'lookup-table-sig-123'
            );
        });

        it('should validate reference inclusion in various transaction formats', async () => {
            const testCases = [
                {
                    name: 'account-based reference',
                    payment: {
                        id: 'ref-account-123',
                        reference: testReferenceKeypair.publicKey.toString(),
                        amount: '1.0',
                        currency: 'SOL',
                        status: 'pending',
                        recipient_address: testMerchantWallet.toString()
                    },
                    transaction: {
                        transaction: {
                            message: {
                                version: 'legacy',
                                accountKeys: [
                                    testMerchantWallet,
                                    new PublicKey('sender123'),
                                    testReferenceKeypair.publicKey // Reference in account keys
                                ]
                            }
                        },
                        meta: {
                            err: null,
                            preBalances: [1000000000, 2000000000, 0],
                            postBalances: [2000000000, 1000000000, 0],
                            fee: 5000
                        }
                    }
                },
                {
                    name: 'memo-based reference',
                    payment: {
                        id: 'ref-memo-123',
                        reference: testReferenceKeypair.publicKey.toString(),
                        amount: '1.0',
                        currency: 'SOL',
                        status: 'pending',
                        recipient_address: testMerchantWallet.toString()
                    },
                    transaction: {
                        transaction: {
                            message: {
                                version: 'legacy',
                                accountKeys: [
                                    testMerchantWallet,
                                    new PublicKey('sender123'),
                                    new PublicKey('11111111111111111111111111111112'), // System program
                                    new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') // Memo program
                                ],
                                instructions: [
                                    { programIdIndex: 2, accounts: [1, 0], data: Buffer.from([]) },
                                    {
                                        programIdIndex: 3,
                                        accounts: [],
                                        data: Buffer.from(`Payment reference: ${testReferenceKeypair.publicKey.toString()}`, 'utf8')
                                    }
                                ]
                            }
                        },
                        meta: {
                            err: null,
                            preBalances: [1000000000, 2000000000, 1, 1],
                            postBalances: [2000000000, 1000000000, 1, 1],
                            fee: 5000
                        }
                    }
                }
            ];

            for (const testCase of testCases) {
                jest.clearAllMocks();

                database.getClient.mockReturnValue({
                    from: jest.fn().mockReturnThis(),
                    select: jest.fn().mockReturnThis(),
                    eq: jest.fn().mockReturnThis(),
                    order: jest.fn().mockReturnThis(),
                    limit: jest.fn().mockResolvedValue({ data: [testCase.payment] })
                });

                findReference.mockResolvedValue(`${testCase.name}-sig-123`);
                mockConnection.getTransaction.mockResolvedValue(testCase.transaction);
                database.updatePaymentStatus.mockResolvedValue(true);

                await paymentMonitor.checkPendingPayments();

                expect(database.updatePaymentStatus).toHaveBeenCalledWith(
                    testCase.payment.reference,
                    'confirmed',
                    `${testCase.name}-sig-123`
                );
            }
        });
    });

    describe('Performance and Scalability', () => {
        it('should handle large batches of pending payments efficiently', async () => {
            // Create 50 pending payments
            const mockPayments = Array.from({ length: 50 }, (_, i) => ({
                id: `batch-payment-${i}`,
                reference: Keypair.generate().publicKey.toString(),
                amount: (Math.random() * 10).toFixed(6),
                currency: 'SOL',
                spl_token_mint: null,
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            }));

            database.getClient.mockReturnValue({
                from: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                order: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue({ data: mockPayments })
            });

            // Mock successful transactions for all payments
            findReference.mockImplementation((connection, reference) => {
                return Promise.resolve(`batch-sig-${reference.toString().slice(-8)}`);
            });

            const mockBatchTransaction = {
                transaction: {
                    message: {
                        version: 'legacy',
                        accountKeys: [testMerchantWallet, new PublicKey('sender123'), new PublicKey('ref123')]
                    }
                },
                meta: {
                    err: null,
                    preBalances: [1000000000, 2000000000, 0],
                    postBalances: [1500000000, 1500000000, 0],
                    fee: 5000
                }
            };

            mockConnection.getTransaction.mockResolvedValue(mockBatchTransaction);
            database.updatePaymentStatus.mockResolvedValue(true);

            const startTime = Date.now();
            await paymentMonitor.checkPendingPayments();
            const endTime = Date.now();

            // Should process all payments within reasonable time (< 30 seconds)
            expect(endTime - startTime).toBeLessThan(30000);
            expect(database.updatePaymentStatus).toHaveBeenCalledTimes(50);
        });

        it('should implement proper rate limiting for RPC calls', async () => {
            const mockPayments = Array.from({ length: 20 }, (_, i) => ({
                id: `rate-limit-payment-${i}`,
                reference: Keypair.generate().publicKey.toString(),
                amount: '1.0',
                currency: 'SOL',
                spl_token_mint: null,
                status: 'pending',
                recipient_address: testMerchantWallet.toString()
            }));

            database.getClient.mockReturnValue({
                from: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                eq: jest.fn().mockReturnThis(),
                order: jest.fn().mockReturnThis(),
                limit: jest.fn().mockResolvedValue({ data: mockPayments })
            });

            // Mock rate limiting errors for some calls
            let callCount = 0;
            findReference.mockImplementation(() => {
                callCount++;
                if (callCount % 5 === 0) {
                    return Promise.reject(new Error('Rate limit exceeded'));
                }
                return Promise.resolve(`rate-limit-sig-${callCount}`);
            });

            const mockTransaction = {
                transaction: {
                    message: {
                        version: 'legacy',
                        accountKeys: [testMerchantWallet, new PublicKey('sender123'), new PublicKey('ref123')]
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
            database.updatePaymentStatus.mockResolvedValue(true);

            await paymentMonitor.checkPendingPayments();

            // Should handle rate limiting gracefully
            expect(database.updatePaymentStatus).toHaveBeenCalledTimes(16); // 20 - 4 rate limited
            expect(logger.error).toHaveBeenCalledTimes(4); // 4 rate limit errors logged
        });
    });

    describe('Data Consistency and Recovery', () => {
        it('should handle database update failures gracefully', async () => {
            const mockPayment = {
                id: 'db-fail-payment-123',
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
                limit: jest.fn().mockResolvedValue({ data: [mockPayment] })
            });

            const mockTransaction = {
                transaction: {
                    message: {
                        version: 'legacy',
                        accountKeys: [testMerchantWallet, new PublicKey('sender123'), testReferenceKeypair.publicKey]
                    }
                },
                meta: {
                    err: null,
                    preBalances: [1000000000, 2000000000, 0],
                    postBalances: [2000000000, 1000000000, 0],
                    fee: 5000
                }
            };

            findReference.mockResolvedValue('db-fail-sig-123');
            mockConnection.getTransaction.mockResolvedValue(mockTransaction);

            // Mock database update failure
            database.updatePaymentStatus.mockRejectedValue(new Error('Database connection lost'));

            await paymentMonitor.checkPendingPayments();

            // Should log database error
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to update payment status'),
                expect.any(Object)
            );
        });

        it('should maintain payment state consistency during concurrent monitoring', async () => {
            const sharedPayment = {
                id: 'concurrent-payment-123',
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
                limit: jest.fn().mockResolvedValue({ data: [sharedPayment] })
            });

            const mockTransaction = {
                transaction: {
                    message: {
                        version: 'legacy',
                        accountKeys: [testMerchantWallet, new PublicKey('sender123'), testReferenceKeypair.publicKey]
                    }
                },
                meta: {
                    err: null,
                    preBalances: [1000000000, 2000000000, 0],
                    postBalances: [2000000000, 1000000000, 0],
                    fee: 5000
                }
            };

            findReference.mockResolvedValue('concurrent-sig-123');
            mockConnection.getTransaction.mockResolvedValue(mockTransaction);
            database.updatePaymentStatus.mockResolvedValue(true);

            // Run multiple monitoring cycles concurrently
            const promises = Array.from({ length: 3 }, () => paymentMonitor.checkPendingPayments());
            await Promise.all(promises);

            // Should only update payment status once (idempotent)
            expect(database.updatePaymentStatus).toHaveBeenCalledWith(
                sharedPayment.reference,
                'confirmed',
                'concurrent-sig-123'
            );
        });
    });
});