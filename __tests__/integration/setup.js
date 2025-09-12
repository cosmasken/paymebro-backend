/**
 * Integration Test Setup
 * 
 * This file sets up the test environment for integration tests,
 * including mocks, test data, and global configurations.
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.MERCHANT_WALLET_ADDRESS = 'GDBPQ6G7k9xMFcmz2GqEgmcesC6DRzeWQPfRPk1hQNBo';
process.env.SOLANA_RPC_URL = 'https://api.devnet.solana.com';

// Global test timeout
jest.setTimeout(30000);

// Mock console methods to reduce noise in test output
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

beforeAll(() => {
    // Suppress console output during tests unless explicitly needed
    console.error = jest.fn();
    console.warn = jest.fn();
});

afterAll(() => {
    // Restore original console methods
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
});

// Global test utilities
global.testUtils = {
    // Generate test payment data
    createTestPayment: (overrides = {}) => ({
        id: 'test-payment-123',
        reference: 'test-reference-key',
        web3auth_user_id: 'test-user-123',
        amount: '1.0',
        currency: 'SOL',
        spl_token_mint: null,
        status: 'pending',
        recipient_address: 'GDBPQ6G7k9xMFcmz2GqEgmcesC6DRzeWQPfRPk1hQNBo',
        created_at: new Date().toISOString(),
        ...overrides
    }),

    // Generate test user data
    createTestUser: (overrides = {}) => ({
        id: 'test-user-123',
        web3auth_user_id: 'web3-test-123',
        solana_address: 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH',
        ethereum_address: '0x1234567890123456789012345678901234567890',
        email: 'test@example.com',
        plan_type: 'free',
        ...overrides
    }),

    // Generate test transaction data
    createTestTransaction: (overrides = {}) => ({
        transaction: {
            message: {
                version: 'legacy',
                accountKeys: [
                    'TestMerchantWallet111111111111111111111111',
                    'TestUserWallet1111111111111111111111111111',
                    'test-reference-key'
                ],
                instructions: [
                    {
                        programIdIndex: 0,
                        accounts: [1, 0],
                        data: Buffer.from([])
                    }
                ]
            }
        },
        meta: {
            err: null,
            preBalances: [1000000000, 2000000000, 0],
            postBalances: [2000000000, 1000000000, 0],
            fee: 5000
        },
        ...overrides
    }),

    // Wait for async operations
    wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

    // Generate random test data
    randomAmount: () => (Math.random() * 10).toFixed(6),
    randomReference: () => Math.random().toString(36).substring(2, 15),
    randomSignature: () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
};

// Mock external services that shouldn't be called during integration tests
jest.mock('../../src/services/emailService', () => ({
    sendPaymentConfirmation: jest.fn().mockResolvedValue(true),
    sendPaymentNotification: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../src/controllers/webhooks', () => ({
    sendWebhook: jest.fn().mockResolvedValue(true)
}));

// Setup global error handling for unhandled promises
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

console.log('🔧 Integration test environment setup complete');