#!/usr/bin/env node

// Test script for MVP Payment Server
// Run with: node test.js

import axios from 'axios';

const BASE_URL = 'http://localhost:3001';
const TEST_USER_ID = '2c45b0ab-f5e3-4de1-87e2-1d46ba8865ba';
const TEST_WALLET = 'EHwtMrGE6V5fH3xUKYcoHzbouUqfgB4jd7MsqfQfHVSn';

async function testServer() {
  console.log('🧪 Testing MVP Payment Server...\n');

  try {
    // 1. Health Check
    console.log('1. Health Check');
    const health = await axios.get(`${BASE_URL}/health`);
    console.log('✅ Health:', health.data.status);
    console.log();

    // 2. Create Payment
    console.log('2. Create Payment');
    const payment = await axios.post(`${BASE_URL}/api/payments`, {
      amount: 10,
      currency: 'SOL',
      description: 'Test payment',
      merchantWallet: TEST_WALLET,
      userId: TEST_USER_ID,
      title: 'Test Payment'
    });
    console.log('✅ Payment created:', payment.data.reference);
    const reference = payment.data.reference;
    console.log();

    // 3. Get Payment Status
    console.log('3. Get Payment Status');
    const status = await axios.get(`${BASE_URL}/api/payments/${reference}`);
    console.log('✅ Payment status:', status.data.status);
    console.log();

    // 4. Generate QR Code
    console.log('4. Generate QR Code');
    const qr = await axios.get(`${BASE_URL}/api/qr/${reference}`);
    console.log('✅ QR Code generated:', qr.data.success);
    console.log();

    // 5. Create Invoice
    console.log('5. Create Invoice');
    const invoice = await axios.post(`${BASE_URL}/api/invoices`, {
      amount: 25,
      currency: 'USDC',
      description: 'Test invoice',
      customerEmail: 'test@example.com',
      merchantId: TEST_USER_ID
    });
    console.log('✅ Invoice created:', invoice.data.invoice.id);
    console.log();

    // 6. Create Payment Link
    console.log('6. Create Payment Link');
    const link = await axios.post(`${BASE_URL}/api/payment-links`, {
      title: 'Test Payment Link',
      amount: 5,
      currency: 'SOL',
      description: 'Test link payment',
      merchantId: TEST_USER_ID
    });
    console.log('✅ Payment link created:', link.data.link.reference);
    console.log();

    // 7. CCTP Transfer
    console.log('7. CCTP Transfer');
    const cctp = await axios.post(`${BASE_URL}/api/cctp/transfer`, {
      amount: 100,
      fromChain: 'ethereum',
      toChain: 'solana',
      recipient: TEST_WALLET,
      burnTxHash: '0x123...abc'
    });
    console.log('✅ CCTP transfer initiated:', cctp.data.transfer.id);
    console.log();

    // 8. Get Analytics
    console.log('8. Get Analytics');
    const analytics = await axios.get(`${BASE_URL}/api/analytics/dashboard/${TEST_USER_ID}`);
    console.log('✅ Analytics retrieved:', analytics.data.analytics.transactionCount, 'transactions');
    console.log();

    // 9. Solana Pay Transaction Request
    console.log('9. Solana Pay Transaction Request');
    const solanaPayGet = await axios.get(`${BASE_URL}/api/solana-pay/transaction?reference=${reference}`);
    console.log('✅ Solana Pay GET:', solanaPayGet.data.label);
    console.log();

    console.log('🎉 All tests passed! MVP server is working correctly.');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// Run tests
testServer();
