const request = require('supertest');
const express = require('express');
const database = require('../../src/services/database');
const { asyncHandler } = require('../../src/middleware/errorHandler');

// Mock all external dependencies
jest.mock('@solana/web3.js', () => ({
  Keypair: jest.fn().mockImplementation(() => ({
    publicKey: {
      toString: () => 'test-reference-key'
    }
  })),
  PublicKey: jest.fn().mockImplementation((key) => ({
    toString: () => key
  }))
}));

jest.mock('@solana/pay', () => ({
  encodeURL: jest.fn().mockReturnValue({
    toString: () => 'solana:test-url'
  })
}));

// Mock the database service
jest.mock('../../src/services/database');
jest.mock('../../src/services/websocket');
jest.mock('../../src/services/emailService');
jest.mock('../../src/utils/logger');

// Mock BigNumber
jest.mock('bignumber.js', () => {
  return jest.fn().mockImplementation((value) => ({
    toString: () => value.toString(),
    multipliedBy: (x) => new (require('bignumber.js'))(value * x),
    plus: (x) => new (require('bignumber.js'))(parseFloat(value) + parseFloat(x))
  }));
});

// Import controllers after mocking dependencies
const { createPayment, getPayment, confirmPayment } = require('../../src/controllers/payments');

// Create a test app
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  
  // Mock the payment routes
  app.post('/payments/create', asyncHandler(createPayment));
  app.get('/payments/:reference', asyncHandler(getPayment));
  app.post('/payments/confirm', asyncHandler(confirmPayment));
  
  return app;
};

describe('Payment Flow', () => {
  let app;
  
  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });
  
  describe('Create Payment', () => {
    it('should create a payment successfully', async () => {
      // Mock user exists
      database.getUserById.mockResolvedValue({
        id: 'user-123',
        web3auth_user_id: 'web3-123',
        solana_address: 'solana-addr-123',
        ethereum_address: 'eth-addr-123'
      });
      
      // Mock payment creation
      database.createPayment.mockResolvedValue({
        id: 'payment-123',
        reference: 'test-reference-key',
        web3auth_user_id: 'web3-123',
        amount: '1.5',
        currency: 'SOL',
        status: 'pending',
        recipient_address: 'solana-addr-123'
      });
      
      const response = await request(app)
        .post('/payments/create')
        .send({
          amount: 1.5,
          label: 'Test Payment',
          message: 'Test message',
          web3AuthUserId: 'web3-123',
          chain: 'solana'
        })
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.payment).toBeDefined();
      expect(response.body.reference).toBe('test-reference-key');
      expect(database.getUserById).toHaveBeenCalledWith('web3-123');
      expect(database.createPayment).toHaveBeenCalled();
    });
    
    it('should fail if user not found', async () => {
      // Mock user not found
      database.getUserById.mockResolvedValue(null);
      
      const response = await request(app)
        .post('/payments/create')
        .send({
          amount: 1.5,
          label: 'Test Payment',
          message: 'Test message',
          web3AuthUserId: 'web3-123',
          chain: 'solana'
        })
        .expect(400);
      
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('User not found. Please complete onboarding first.');
    });
  });
  
  describe('Get Payment', () => {
    it('should retrieve a payment successfully', async () => {
      // Mock payment retrieval
      database.getPayment.mockResolvedValue({
        id: 'payment-123',
        reference: 'ref-123',
        web3auth_user_id: 'web3-123',
        amount: '1.5',
        currency: 'SOL',
        status: 'pending'
      });
      
      const response = await request(app)
        .get('/payments/ref-123')
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.payment).toBeDefined();
      expect(response.body.payment.reference).toBe('ref-123');
    });
    
    it('should return 404 if payment not found', async () => {
      // Mock payment not found
      database.getPayment.mockResolvedValue(null);
      
      const response = await request(app)
        .get('/payments/ref-123')
        .expect(404);
      
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Payment not found');
    });
  });
});