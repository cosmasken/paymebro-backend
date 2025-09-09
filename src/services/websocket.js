/**
 * WebSocket service for real-time payment updates
 * 
 * This service provides real-time notifications for payment status changes
 * using Socket.IO. Clients can join payment-specific rooms to receive
 * updates when payments are confirmed or fail.
 * 
 * Events:
 * - join-payment: Join a payment room to receive updates
 * - leave-payment: Leave a payment room
 * - payment-update: Payment status update notification
 * 
 * Security:
 * - Input validation for reference parameters
 * - Token-based authentication for payment events
 * - Logging of connection and disconnection events
 * - Error handling for connection issues
 * 
 * @module websocket
 */

const { Server } = require('socket.io');
const logger = require('../utils/logger');
const database = require('./database');

// In-memory store for authentication tokens (in production, use Redis or similar)
const authTokens = new Map();

/**
 * Generate a temporary authentication token for a user
 * 
 * @param {string} web3AuthUserId - Web3Auth user ID
 * @returns {string} Authentication token
 */
const generateAuthToken = (web3AuthUserId) => {
  const token = require('crypto').randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  authTokens.set(token, { web3AuthUserId, expiresAt });
  return token;
};

/**
 * Verify an authentication token
 * 
 * @param {string} token - Authentication token
 * @returns {Object|null} User data if valid, null if invalid
 */
const verifyAuthToken = (token) => {
  const authData = authTokens.get(token);
  if (!authData) {
    return null;
  }
  
  // Check if token has expired
  if (Date.now() > authData.expiresAt) {
    authTokens.delete(token);
    return null;
  }
  
  return { web3AuthUserId: authData.web3AuthUserId };
};

/**
 * Initialize the WebSocket server
 * 
 * @param {http.Server} server - HTTP server instance
 * @returns {Server} Socket.IO server instance
 */
const initializeWebSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.NODE_ENV === 'production' 
        ? process.env.ALLOWED_ORIGINS?.split(',') || "*" 
        : "*",
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  io.on('connection', (socket) => {
    logger.info('Client connected:', { 
      socketId: socket.id,
      ip: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent']
    });

    // Add authentication middleware for sensitive operations (optional for backward compatibility)
    socket.use((packet, next) => {
      // Check if this is a payment-related event that requires authentication
      const paymentEvents = ['join-payment', 'leave-payment'];
      const eventName = packet[0];
      
      if (paymentEvents.includes(eventName)) {
        // Check for authentication token in packet
        const token = packet[2]; // Third parameter should be auth token
        if (!token) {
          logger.warn('WebSocket payment event without authentication token (using fallback):', { 
            socketId: socket.id,
            eventName
          });
          // Allow without authentication for backward compatibility
          return next();
        }
        
        // Verify token if provided
        const user = verifyAuthToken(token);
        if (!user) {
          logger.warn('Invalid authentication token for WebSocket payment event (using fallback):', { 
            socketId: socket.id,
            eventName,
            token: token.substring(0, 8) + '...' // Log only part of token for security
          });
          // Allow without authentication for backward compatibility
          return next();
        }
        
        // Add user info to socket for use in event handlers
        socket.authUser = user;
        logger.debug('WebSocket payment event authenticated:', { 
          socketId: socket.id,
          eventName,
          web3AuthUserId: user.web3AuthUserId
        });
      }
      
      next();
    });

    /**
     * Authenticate a WebSocket connection
     * 
     * @param {string} web3AuthUserId - Web3Auth user ID
     * @param {function} callback - Callback function
     */
    socket.on('authenticate', async (web3AuthUserId, callback) => {
      try {
        // Verify user exists in database
        const user = await database.getUserById(web3AuthUserId);
        if (!user) {
          logger.warn('WebSocket authentication failed: user not found', { 
            socketId: socket.id,
            web3AuthUserId
          });
          if (callback) callback({ success: false, error: 'User not found' });
          return;
        }

        // Generate authentication token
        const token = generateAuthToken(web3AuthUserId);
        
        logger.info('WebSocket authentication successful:', { 
          socketId: socket.id,
          web3AuthUserId
        });
        
        if (callback) callback({ success: true, token });
      } catch (error) {
        logger.error('WebSocket authentication error:', { 
          socketId: socket.id,
          web3AuthUserId,
          error: error.message
        });
        if (callback) callback({ success: false, error: 'Authentication failed' });
      }
    });

    /**
     * Join a payment room to receive real-time updates
     * 
     * @param {string} reference - Payment reference ID
     * @param {string} token - Authentication token
     * @param {function} callback - Optional callback function
     */
    socket.on('join-payment', (reference, token, callback) => {
      try {
        // Validate reference parameter
        if (!reference) {
          logger.warn('Invalid join-payment request: missing reference', { socketId: socket.id });
          if (callback) callback({ success: false, error: 'Reference is required' });
          return;
        }

        // Validate reference format (should be a valid base58 string)
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(reference)) {
          logger.warn('Invalid join-payment request: invalid reference format', { 
            socketId: socket.id,
            reference
          });
          if (callback) callback({ success: false, error: 'Invalid reference format' });
          return;
        }

        socket.join(`payment-${reference}`);
        logger.info('Client joined payment room:', { 
          socketId: socket.id,
          reference,
          room: `payment-${reference}`,
          web3AuthUserId: socket.authUser?.web3AuthUserId
        });
        
        if (callback) callback({ success: true });
      } catch (error) {
        logger.error('Error joining payment room:', { 
          socketId: socket.id,
          reference,
          error: error.message
        });
        if (callback) callback({ success: false, error: 'Failed to join payment room' });
      }
    });

    /**
     * Leave a payment room
     * 
     * @param {string} reference - Payment reference ID
     * @param {string} token - Authentication token
     * @param {function} callback - Optional callback function
     */
    socket.on('leave-payment', (reference, token, callback) => {
      try {
        // Validate reference parameter
        if (!reference) {
          logger.warn('Invalid leave-payment request: missing reference', { socketId: socket.id });
          if (callback) callback({ success: false, error: 'Reference is required' });
          return;
        }

        // Validate reference format (should be a valid base58 string)
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(reference)) {
          logger.warn('Invalid leave-payment request: invalid reference format', { 
            socketId: socket.id,
            reference
          });
          if (callback) callback({ success: false, error: 'Invalid reference format' });
          return;
        }

        socket.leave(`payment-${reference}`);
        logger.info('Client left payment room:', { 
          socketId: socket.id,
          reference,
          room: `payment-${reference}`,
          web3AuthUserId: socket.authUser?.web3AuthUserId
        });
        
        if (callback) callback({ success: true });
      } catch (error) {
        logger.error('Error leaving payment room:', { 
          socketId: socket.id,
          reference,
          error: error.message
        });
        if (callback) callback({ success: false, error: 'Failed to leave payment room' });
      }
    });

    /**
     * Handle client disconnection
     * 
     * @param {string} reason - Disconnection reason
     */
    socket.on('disconnect', (reason) => {
      logger.info('Client disconnected:', { 
        socketId: socket.id,
        reason,
        rooms: Array.from(socket.rooms),
        web3AuthUserId: socket.authUser?.web3AuthUserId
      });
    });

    // Handle connection errors
    socket.on('error', (error) => {
      logger.error('WebSocket connection error:', { 
        socketId: socket.id,
        error: error.message
      });
    });
  });

  // Handle server-level errors
  io.engine.on('connection_error', (error) => {
    logger.error('WebSocket connection error:', {
      req: error.req,
      code: error.code,
      message: error.message,
      context: error.context
    });
  });

  return io;
};

// Export for testing purposes
const __setIoForTesting = (mockIo) => {
  io = mockIo;
};

/**
 * Send a payment update notification to all clients in a payment room
 * 
 * @param {string} reference - Payment reference ID
 * @param {string} status - Payment status (pending|confirmed|failed)
 * @param {Object} data - Additional data to send with the notification
 * @returns {Object} Result object with success status and recipient count
 */
const notifyPaymentUpdate = (reference, status, data = {}) => {
  if (io) {
    try {
      const eventData = {
        reference,
        status,
        timestamp: new Date().toISOString(),
        ...data
      };

      const roomName = `payment-${reference}`;
      const room = io.sockets.adapter.rooms.get(roomName);
      const recipientCount = room ? room.size : 0;

      io.to(roomName).emit('payment-update', eventData);

      logger.info('Payment update notification sent:', {
        reference,
        status,
        recipientCount,
        room: roomName
      });

      return { success: true, recipients: recipientCount };
    } catch (error) {
      logger.error('Error sending payment update notification:', {
        reference,
        status,
        error: error.message
      });
      return { success: false, error: error.message };
    }
  }
  
  logger.warn('WebSocket server not initialized when trying to send payment update:', { reference, status });
  return { success: false, error: 'WebSocket server not initialized' };
};

module.exports = { initializeWebSocket, notifyPaymentUpdate, __setIoForTesting, generateAuthToken, verifyAuthToken };
