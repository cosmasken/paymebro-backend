const paymentMonitor = require('../../src/services/paymentMonitor');
const database = require('../../src/services/database');
const logger = require('../../src/utils/logger');

// Mock all dependencies
jest.mock('../../src/services/database');
jest.mock('../../src/utils/logger');

describe('Payment Monitor Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('getConnection', () => {
    it('should return existing connection if already established', async () => {
      const mockConnection = { mock: 'connection' };
      paymentMonitor.connection = mockConnection;
      
      const connection = await paymentMonitor.getConnection();
      
      expect(connection).toBe(mockConnection);
    });
  });
  
  describe('checkPendingPayments', () => {
    it('should process pending payments successfully', async () => {
      const mockPendingPayments = [
        { id: 'payment-1', reference: 'ref-1', status: 'pending' },
        { id: 'payment-2', reference: 'ref-2', status: 'pending' }
      ];
      
      database.getClient.mockReturnValue({
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: mockPendingPayments })
      });
      
      paymentMonitor.checkPaymentConfirmation = jest.fn();
      
      await paymentMonitor.checkPendingPayments();
      
      expect(paymentMonitor.checkPaymentConfirmation).toHaveBeenCalledTimes(2);
    });
    
    it('should handle empty pending payments', async () => {
      database.getClient.mockReturnValue({
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [] })
      });
      
      paymentMonitor.checkPaymentConfirmation = jest.fn();
      
      await paymentMonitor.checkPendingPayments();
      
      expect(paymentMonitor.checkPaymentConfirmation).not.toHaveBeenCalled();
    });
  });
});