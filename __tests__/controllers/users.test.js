const request = require('supertest');
const express = require('express');
const database = require('../../src/services/database');
const { asyncHandler } = require('../../src/middleware/errorHandler');

// Mock the database service
jest.mock('../../src/services/database');
jest.mock('../../src/utils/logger');

// Import controllers after mocking dependencies
const { registerUser, getProfile, completeOnboarding, getOnboardingStatus } = require('../../src/controllers/users');

// Create a test app
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  
  // Mock the user routes
  app.post('/users/register', asyncHandler(registerUser));
  app.get('/users/profile/:web3AuthUserId', asyncHandler(getProfile));
  app.post('/users/onboarding/complete', asyncHandler(completeOnboarding));
  app.get('/users/onboarding/status/:web3AuthUserId', asyncHandler(getOnboardingStatus));
  
  return app;
};

describe('User Management', () => {
  let app;
  
  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });
  
  describe('Register User', () => {
    it('should register a user successfully', async () => {
      // Mock database response
      const mockDatabaseResponse = {
        data: {
          id: 'user-123',
          web3auth_user_id: 'web3-123',
          email: 'test@example.com',
          solana_address: 'solana-addr-123',
          ethereum_address: 'eth-addr-123',
          onboarding_completed: false
        }
      };
      
      database.getClient.mockReturnValue({
        rpc: jest.fn().mockResolvedValue(mockDatabaseResponse)
      });
      
      const response = await request(app)
        .post('/users/register')
        .send({
          web3AuthUserId: 'web3-123',
          email: 'test@example.com',
          solanaAddress: 'solana-addr-123',
          ethereumAddress: 'eth-addr-123'
        })
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.user).toBeDefined();
      expect(response.body.isNewUser).toBe(true);
    });
    
    it('should fail if required fields are missing', async () => {
      const response = await request(app)
        .post('/users/register')
        .send({
          web3AuthUserId: 'web3-123',
          email: 'test@example.com'
          // Missing solanaAddress and ethereumAddress
        })
        .expect(400);
      
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Missing required fields: web3AuthUserId, solanaAddress, ethereumAddress');
    });
    
    it('should handle database errors', async () => {
      database.getClient.mockReturnValue({
        rpc: jest.fn().mockRejectedValue(new Error('Database error'))
      });
      
      const response = await request(app)
        .post('/users/register')
        .send({
          web3AuthUserId: 'web3-123',
          email: 'test@example.com',
          solanaAddress: 'solana-addr-123',
          ethereumAddress: 'eth-addr-123'
        })
        .expect(500);
      
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Failed to register user');
    });
  });
  
  describe('Get User Profile', () => {
    it('should retrieve a user profile successfully', async () => {
      // Mock user retrieval
      database.getUserById.mockResolvedValue({
        id: 'user-123',
        web3auth_user_id: 'web3-123',
        email: 'test@example.com',
        solana_address: 'solana-addr-123',
        ethereum_address: 'eth-addr-123'
      });
      
      const response = await request(app)
        .get('/users/profile/web3-123')
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.user).toBeDefined();
      expect(response.body.user.web3auth_user_id).toBe('web3-123');
    });
    
    it('should return 404 if user not found', async () => {
      // Mock user not found
      database.getUserById.mockResolvedValue(null);
      
      const response = await request(app)
        .get('/users/profile/web3-123')
        .expect(404);
      
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('User not found');
    });
    
    it('should handle database errors', async () => {
      // Mock database error
      database.getUserById.mockRejectedValue(new Error('Database error'));
      
      const response = await request(app)
        .get('/users/profile/web3-123')
        .expect(500);
      
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Failed to retrieve user profile');
    });
  });
  
  describe('Complete Onboarding', () => {
    it('should complete user onboarding successfully', async () => {
      // Mock onboarding completion
      database.completeUserOnboarding.mockResolvedValue({
        id: 'user-123',
        web3auth_user_id: 'web3-123',
        first_name: 'John',
        last_name: 'Doe',
        business_name: 'Test Business',
        onboarding_completed: true
      });
      
      const response = await request(app)
        .post('/users/onboarding/complete')
        .send({
          web3AuthUserId: 'web3-123',
          firstName: 'John',
          lastName: 'Doe',
          businessName: 'Test Business'
        })
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.user).toBeDefined();
      expect(response.body.user.first_name).toBe('John');
      expect(database.completeUserOnboarding).toHaveBeenCalledWith('web3-123', {
        first_name: 'John',
        last_name: 'Doe',
        business_name: 'Test Business',
        phone_number: undefined,
        country: undefined
      });
    });
    
    it('should handle database errors', async () => {
      // Mock database error
      database.completeUserOnboarding.mockRejectedValue(new Error('Database error'));
      
      const response = await request(app)
        .post('/users/onboarding/complete')
        .send({
          web3AuthUserId: 'web3-123',
          firstName: 'John',
          lastName: 'Doe'
        })
        .expect(500);
      
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Failed to complete onboarding');
    });
  });
  
  describe('Get Onboarding Status', () => {
    it('should retrieve onboarding status successfully', async () => {
      // Mock onboarding status
      database.checkUserOnboardingStatus.mockResolvedValue({
        onboarding_completed: true,
        first_name: 'John',
        last_name: 'Doe',
        business_name: 'Test Business'
      });
      
      const response = await request(app)
        .get('/users/onboarding/status/web3-123')
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.onboardingCompleted).toBe(true);
      expect(response.body.userInfo).toBeDefined();
    });
    
    it('should return 404 if user not found', async () => {
      // Mock user not found
      database.checkUserOnboardingStatus.mockResolvedValue(null);
      
      const response = await request(app)
        .get('/users/onboarding/status/web3-123')
        .expect(404);
      
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('User not found');
    });
    
    it('should handle database errors', async () => {
      // Mock database error
      database.checkUserOnboardingStatus.mockRejectedValue(new Error('Database error'));
      
      const response = await request(app)
        .get('/users/onboarding/status/web3-123')
        .expect(500);
      
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Failed to check onboarding status');
    });
  });
});