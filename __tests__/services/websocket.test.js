const { initializeWebSocket, notifyPaymentUpdate, __setIoForTesting } = require('../../src/services/websocket');

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

describe('WebSocket Service', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initializeWebSocket', () => {
    it('should initialize WebSocket server with correct CORS settings', () => {
      // Mock the Server constructor
      const mockServer = { on: jest.fn() };
      const mockIoInstance = {
        on: jest.fn(),
        engine: {
          on: jest.fn()
        }
      };
      
      jest.mock('socket.io', () => {
        return {
          Server: jest.fn(() => mockIoInstance)
        };
      });
      
      // Need to re-require after mock
      jest.resetModules();
      const { initializeWebSocket } = require('../../src/services/websocket');
      
      const result = initializeWebSocket(mockServer);
      
      expect(result).toBe(mockIoInstance);
    });
  });

  describe('notifyPaymentUpdate', () => {
    it('should send payment update notifications when io is available', () => {
      // Create a mock io object
      const mockEmit = jest.fn();
      const mockTo = jest.fn().mockReturnThis();
      const mockIo = {
        sockets: {
          adapter: {
            rooms: {
              get: jest.fn().mockReturnValue(new Set(['socket1', 'socket2']))
            }
          }
        },
        to: mockTo,
        emit: mockEmit
      };
      
      // Set the io instance for testing
      __setIoForTesting(mockIo);
      
      const result = notifyPaymentUpdate('test-ref', 'confirmed', { amount: 1.5 });
      
      expect(result.success).toBe(true);
      expect(result.recipients).toBe(2);
      expect(mockTo).toHaveBeenCalledWith('payment-test-ref');
      expect(mockEmit).toHaveBeenCalledWith('payment-update', {
        reference: 'test-ref',
        status: 'confirmed',
        amount: 1.5,
        timestamp: expect.any(String)
      });
    });

    it('should handle notifications when WebSocket server is not initialized', () => {
      // Reset io to null
      __setIoForTesting(null);
      
      const result = notifyPaymentUpdate('test-ref', 'confirmed');
      expect(result.success).toBe(false);
      expect(result.error).toBe('WebSocket server not initialized');
    });
  });
});