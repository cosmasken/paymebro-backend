'use strict';
/**
 * Main entry point for the Solana Pay server application
 * 
 * This application provides a REST API for creating and managing Solana Pay payments,
 * with real-time updates via WebSockets, user management, and payment monitoring.
 * 
 * Features:
 * - Payment creation and management with Solana Pay URLs
 * - Real-time payment status updates via WebSockets
 * - User registration and onboarding
 * - Automatic payment monitoring and confirmation
 * - Email notifications
 * - Analytics and metrics tracking
 * 
 * Security:
 * - Rate limiting to prevent abuse
 * - Input validation and sanitization
 * - Helmet.js security middleware
 * - CORS configuration
 * 
 * Environment Variables:
 * - PORT: Server port (default: 3000)
 * - NODE_ENV: Environment (development|production)
 * - SUPABASE_URL: Supabase database URL
 * - SUPABASE_SERVICE_KEY: Supabase service role key
 * - ADMIN_API_KEY: API key for admin endpoints
 * - RESEND_API_KEY: Resend API key for email notifications
 * - FROM_EMAIL: Sender email address
 * - ALLOWED_ORIGINS: Comma-separated list of allowed CORS origins (production only)
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const path = require('path');
const { createServer } = require('http');
const { initializeWebSocket } = require('./services/websocket');
const logger = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const healthCheck = require('./services/healthCheck');
const paymentMonitor = require('./services/paymentMonitor');
const { generalApiLimiter } = require('./middleware/rateLimiting');

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

// Initialize WebSocket
initializeWebSocket(server);

// Trust proxy for X-Forwarded-For headers
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdn.socket.io"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:", "wss:"],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  dnsPrefetchControl: true,
  frameguard: true,
  hidePoweredBy: true,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  ieNoOpen: true,
  noSniff: true,
  referrerPolicy: {
    policy: "strict-origin-when-cross-origin"
  },
  xssFilter: true
}));

app.use(cors({
  origin: true, // Allow all origins temporarily
  credentials: true
}));

// Rate limiting
app.use('/api', generalApiLimiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  logger.info('Request:', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  next();
});

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// Health check endpoints
app.get('/health', async (req, res) => {
  try {
    const health = await healthCheck.checkHealth();
    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/health/ready', async (req, res) => {
  try {
    const readiness = await healthCheck.checkReadiness();
    res.json(readiness);
  } catch (error) {
    res.status(503).json({
      status: 'not ready',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/health/live', (req, res) => {
  const liveness = healthCheck.checkLiveness();
  res.json(liveness);
});

// API Routes
const paymentRoutes = require('./routes/payments');
const userRoutes = require('./routes/users');
const webhookRoutes = require('./routes/webhooks');
const templateRoutes = require('./routes/templates');
const analyticsRoutes = require('./routes/analytics');
const subscriptionRoutes = require('./routes/subscriptions');
const notificationRoutes = require('./routes/notifications');
const emailRoutes = require('./routes/emails');
const planRoutes = require('./routes/plans');
const transactionRequestRoutes = require('./routes/transaction-requests');

// Register API routes
app.use('/api/payments', paymentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/transaction-requests', transactionRequestRoutes);

// Payment page route
app.get('/payment/:reference', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/payment.html'));
});

// Error handling
app.use('*', notFoundHandler);
app.use(errorHandler);

// Graceful shutdown
const gracefulShutdown = (signal) => {
  logger.info(`${signal} received, shutting down gracefully`);

  // Stop payment monitoring
  paymentMonitor.stopMonitoring();

  const server = app.listen(PORT);
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });

  // Force close after 30 seconds
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Start server
server.listen(PORT, () => {
  // logger.info(`Solana Pay server running on port ${PORT}`);
  // logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  // logger.info(`Health check available at: http://localhost:${PORT}/health`);
  // logger.info('WebSocket server initialized');

  // Start automatic payment monitoring
  paymentMonitor.startMonitoring();
  logger.info('Payment monitoring started');
});

module.exports = app;
