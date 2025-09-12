#!/usr/bin/env node

/**
 * Integration Test Runner for SOL Payment Flow
 * 
 * This script runs all integration tests for the SOL payment monitoring system
 * and provides detailed reporting on test results.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('🚀 Starting SOL Payment Integration Tests...\n');

const testFiles = [
    'sol-payment-flow.test.js',
    'payment-monitoring-reliability.test.js'
];

const testResults = {
    passed: 0,
    failed: 0,
    total: 0,
    details: []
};

function runTest(testFile) {
    const testPath = path.join(__dirname, testFile);
    const testName = testFile.replace('.test.js', '');

    console.log(`📋 Running ${testName}...`);

    try {
        const output = execSync(
            `npx jest "${testPath}" --verbose --no-cache --forceExit`,
            {
                cwd: path.join(__dirname, '../../'),
                encoding: 'utf8',
                stdio: 'pipe'
            }
        );

        // Parse Jest output to extract test results
        const lines = output.split('\n');
        const passedTests = lines.filter(line => line.includes('✓')).length;
        const failedTests = lines.filter(line => line.includes('✗')).length;
        const totalTests = passedTests + failedTests;

        testResults.passed += passedTests;
        testResults.failed += failedTests;
        testResults.total += totalTests;

        testResults.details.push({
            file: testFile,
            passed: passedTests,
            failed: failedTests,
            total: totalTests,
            status: failedTests === 0 ? 'PASSED' : 'FAILED',
            output: output
        });

        console.log(`✅ ${testName}: ${passedTests}/${totalTests} tests passed\n`);

    } catch (error) {
        console.log(`❌ ${testName}: Test execution failed`);
        console.log(`Error: ${error.message}\n`);

        testResults.failed += 1;
        testResults.total += 1;

        testResults.details.push({
            file: testFile,
            passed: 0,
            failed: 1,
            total: 1,
            status: 'ERROR',
            error: error.message,
            output: error.stdout || error.stderr || ''
        });
    }
}

// Run all integration tests
testFiles.forEach(runTest);

// Generate summary report
console.log('📊 Integration Test Summary');
console.log('='.repeat(50));
console.log(`Total Tests: ${testResults.total}`);
console.log(`Passed: ${testResults.passed} ✅`);
console.log(`Failed: ${testResults.failed} ${testResults.failed > 0 ? '❌' : '✅'}`);
console.log(`Success Rate: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`);
console.log('');

// Detailed results
testResults.details.forEach(result => {
    console.log(`📄 ${result.file}: ${result.status}`);
    console.log(`   Passed: ${result.passed}, Failed: ${result.failed}, Total: ${result.total}`);

    if (result.status === 'ERROR') {
        console.log(`   Error: ${result.error}`);
    }
    console.log('');
});

// Generate test report file
const reportPath = path.join(__dirname, 'test-report.json');
fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: {
        total: testResults.total,
        passed: testResults.passed,
        failed: testResults.failed,
        successRate: (testResults.passed / testResults.total) * 100
    },
    details: testResults.details
}, null, 2));

console.log(`📋 Detailed report saved to: ${reportPath}`);

// Exit with appropriate code
if (testResults.failed > 0) {
    console.log('\n❌ Some tests failed. Please review the results above.');
    process.exit(1);
} else {
    console.log('\n✅ All integration tests passed successfully!');
    process.exit(0);
}