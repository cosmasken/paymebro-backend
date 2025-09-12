module.exports = {
    displayName: 'Integration Tests',
    testMatch: ['**/__tests__/integration/**/*.test.js'],
    testEnvironment: 'node',
    setupFilesAfterEnv: ['<rootDir>/__tests__/integration/setup.js'],
    collectCoverageFrom: [
        'src/services/paymentMonitor.js',
        'src/controllers/payments.js',
        'src/services/database.js',
        'src/services/websocket.js'
    ],
    coverageDirectory: '__tests__/integration/coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    verbose: true,
    testTimeout: 30000, // 30 seconds for integration tests
    maxWorkers: 1, // Run integration tests sequentially to avoid conflicts
    forceExit: true,
    clearMocks: true,
    resetMocks: true,
    restoreMocks: true
};