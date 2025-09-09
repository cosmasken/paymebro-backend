const database = require('../../src/services/database');
const logger = require('../../src/utils/logger');

// Mock the Supabase client
const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  single: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  upsert: jest.fn().mockReturnThis(),
  rpc: jest.fn().mockReturnThis()
};

// Mock logger
jest.mock('../../src/utils/logger');

describe('Database Service', () => {
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock the Supabase client creation
    process.env.SUPABASE_URL = 'test-url';
    process.env.SUPABASE_SERVICE_KEY = 'test-key';
    
    // Reset the database service instance
    database.supabase = null;
  });
  
  describe('getClient', () => {
    it('should create and return a Supabase client', () => {
      // Mock the Supabase client
      jest.mock('@supabase/supabase-js', () => ({
        createClient: jest.fn().mockReturnValue(mockSupabase)
      }));
      
      // Re-require the module to get the fresh mock
      jest.resetModules();
      const freshDatabase = require('../../src/services/database');
      
      const client = freshDatabase.getClient();
      expect(client).toBeDefined();
    });
    
    it('should throw an error if environment variables are missing', () => {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_KEY;
      
      expect(() => {
        database.getClient();
      }).toThrow('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
    });
  });
  
  describe('createPayment', () => {
    it('should create a payment successfully', async () => {
      const mockPaymentData = {
        reference: 'test-ref',
        web3auth_user_id: 'user-123',
        amount: '1.5'
      };
      
      const mockResponse = {
        data: { id: 'payment-123', ...mockPaymentData },
        error: null
      };
      
      mockSupabase.insert.mockReturnValueOnce(mockSupabase);
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.single.mockResolvedValueOnce(mockResponse);
      
      // Mock getClient to return our mock
      database.getClient = jest.fn().mockReturnValue(mockSupabase);
      
      const result = await database.createPayment(mockPaymentData);
      
      expect(result).toEqual(mockResponse.data);
      expect(mockSupabase.from).toHaveBeenCalledWith('payments');
      expect(mockSupabase.insert).toHaveBeenCalledWith(mockPaymentData);
    });
    
    it('should throw an error if database operation fails', async () => {
      const mockPaymentData = {
        reference: 'test-ref',
        web3auth_user_id: 'user-123',
        amount: '1.5'
      };
      
      const mockError = {
        message: 'Database error',
        code: 'DB_ERROR'
      };
      
      const mockResponse = {
        data: null,
        error: mockError
      };
      
      mockSupabase.insert.mockReturnValueOnce(mockSupabase);
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.single.mockResolvedValueOnce(mockResponse);
      
      // Mock getClient to return our mock
      database.getClient = jest.fn().mockReturnValue(mockSupabase);
      
      await expect(database.createPayment(mockPaymentData))
        .rejects
        .toThrow('Failed to create payment: Database error');
      
      expect(logger.error).toHaveBeenCalled();
    });
  });
  
  describe('getPayment', () => {
    it('should retrieve a payment successfully', async () => {
      const mockPayment = {
        id: 'payment-123',
        reference: 'test-ref',
        web3auth_user_id: 'user-123',
        amount: '1.5'
      };
      
      const mockResponse = {
        data: mockPayment,
        error: null
      };
      
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.single.mockResolvedValueOnce(mockResponse);
      
      // Mock getClient to return our mock
      database.getClient = jest.fn().mockReturnValue(mockSupabase);
      
      const result = await database.getPayment('test-ref');
      
      expect(result).toEqual(mockPayment);
      expect(mockSupabase.from).toHaveBeenCalledWith('payments');
      expect(mockSupabase.select).toHaveBeenCalled();
      expect(mockSupabase.eq).toHaveBeenCalledWith('reference', 'test-ref');
    });
    
    it('should return null if payment not found (PGRST116 error)', async () => {
      const mockError = {
        message: 'Not found',
        code: 'PGRST116'
      };
      
      const mockResponse = {
        data: null,
        error: mockError
      };
      
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.single.mockResolvedValueOnce(mockResponse);
      
      // Mock getClient to return our mock
      database.getClient = jest.fn().mockReturnValue(mockSupabase);
      
      const result = await database.getPayment('test-ref');
      
      expect(result).toBeNull();
    });
    
    it('should throw an error if database operation fails', async () => {
      const mockError = {
        message: 'Database error',
        code: 'DB_ERROR'
      };
      
      const mockResponse = {
        data: null,
        error: mockError
      };
      
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.single.mockResolvedValueOnce(mockResponse);
      
      // Mock getClient to return our mock
      database.getClient = jest.fn().mockReturnValue(mockSupabase);
      
      await expect(database.getPayment('test-ref'))
        .rejects
        .toThrow('Failed to get payment: Database error');
      
      expect(logger.error).toHaveBeenCalled();
    });
  });
  
  describe('updatePaymentStatus', () => {
    it('should update payment status successfully', async () => {
      const mockUpdatedPayment = {
        id: 'payment-123',
        reference: 'test-ref',
        status: 'confirmed',
        transaction_signature: 'sig-123'
      };
      
      const mockResponse = {
        data: mockUpdatedPayment,
        error: null
      };
      
      mockSupabase.update.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.single.mockResolvedValueOnce(mockResponse);
      
      // Mock getClient to return our mock
      database.getClient = jest.fn().mockReturnValue(mockSupabase);
      
      const result = await database.updatePaymentStatus('test-ref', 'confirmed', 'sig-123');
      
      expect(result).toEqual(mockUpdatedPayment);
      expect(mockSupabase.from).toHaveBeenCalledWith('payments');
      expect(mockSupabase.update).toHaveBeenCalledWith({
        status: 'confirmed',
        updated_at: expect.any(String),
        transaction_signature: 'sig-123'
      });
      expect(mockSupabase.eq).toHaveBeenCalledWith('reference', 'test-ref');
    });
    
    it('should throw an error if database operation fails', async () => {
      const mockError = {
        message: 'Database error',
        code: 'DB_ERROR'
      };
      
      const mockResponse = {
        data: null,
        error: mockError
      };
      
      mockSupabase.update.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.single.mockResolvedValueOnce(mockResponse);
      
      // Mock getClient to return our mock
      database.getClient = jest.fn().mockReturnValue(mockSupabase);
      
      await expect(database.updatePaymentStatus('test-ref', 'confirmed', 'sig-123'))
        .rejects
        .toThrow('Failed to update payment: Database error');
      
      expect(logger.error).toHaveBeenCalled();
    });
  });
  
  describe('getUserById', () => {
    it('should retrieve a user successfully', async () => {
      const mockUser = {
        id: 'user-123',
        web3auth_user_id: 'web3-123',
        email: 'test@example.com'
      };
      
      const mockResponse = {
        data: mockUser,
        error: null
      };
      
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.single.mockResolvedValueOnce(mockResponse);
      
      // Mock getClient to return our mock
      database.getClient = jest.fn().mockReturnValue(mockSupabase);
      
      const result = await database.getUserById('web3-123');
      
      expect(result).toEqual(mockUser);
      expect(mockSupabase.from).toHaveBeenCalledWith('users');
      expect(mockSupabase.select).toHaveBeenCalled();
      expect(mockSupabase.eq).toHaveBeenCalledWith('web3auth_user_id', 'web3-123');
    });
    
    it('should return null if user not found (PGRST116 error)', async () => {
      const mockError = {
        message: 'Not found',
        code: 'PGRST116'
      };
      
      const mockResponse = {
        data: null,
        error: mockError
      };
      
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.single.mockResolvedValueOnce(mockResponse);
      
      // Mock getClient to return our mock
      database.getClient = jest.fn().mockReturnValue(mockSupabase);
      
      const result = await database.getUserById('web3-123');
      
      expect(result).toBeNull();
    });
    
    it('should throw an error if database operation fails', async () => {
      const mockError = {
        message: 'Database error',
        code: 'DB_ERROR'
      };
      
      const mockResponse = {
        data: null,
        error: mockError
      };
      
      mockSupabase.select.mockReturnValueOnce(mockSupabase);
      mockSupabase.eq.mockReturnValueOnce(mockSupabase);
      mockSupabase.single.mockResolvedValueOnce(mockResponse);
      
      // Mock getClient to return our mock
      database.getClient = jest.fn().mockReturnValue(mockSupabase);
      
      await expect(database.getUserById('web3-123'))
        .rejects
        .toThrow('Failed to get user: Database error');
      
      expect(logger.error).toHaveBeenCalled();
    });
  });
});