const rateLimit = require('express-rate-limit');

/**
 * Rate limiter for payment creation endpoints
 * More restrictive to prevent abuse
 */
const paymentCreationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 payment creations per windowMs
  message: {
    success: false,
    error: 'Too many payment requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true // Don't count failed requests
});

/**
 * Rate limiter for payment confirmation endpoints
 * Moderate restriction
 */
const paymentConfirmationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 payment confirmations per windowMs
  message: {
    success: false,
    error: 'Too many payment confirmation attempts from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true
});

/**
 * Rate limiter for transaction request endpoints
 * More restrictive as these are used by wallets
 */
const transactionRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 transaction requests per windowMs
  message: {
    success: false,
    error: 'Too many transaction requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true
});

/**
 * Rate limiter for general API endpoints
 * Less restrictive for read operations
 */
const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: true
});

/**
 * Rate limiter for authentication endpoints
 * More restrictive to prevent brute force attacks
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 authentication attempts per windowMs
  message: {
    success: false,
    error: 'Too many authentication attempts from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests: false // Count all requests including failed ones
});

module.exports = {
  paymentCreationLimiter,
  paymentConfirmationLimiter,
  transactionRequestLimiter,
  generalApiLimiter,
  authLimiter
};