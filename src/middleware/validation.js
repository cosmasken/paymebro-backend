const Joi = require('joi');
const logger = require('../utils/logger');
const xss = require('xss');

/**
 * Sanitize user input to prevent XSS attacks
 */
const sanitizeInput = (input) => {
  if (typeof input === 'string') {
    return xss(input);
  }
  if (typeof input === 'object' && input !== null) {
    const sanitized = {};
    for (const key in input) {
      if (input.hasOwnProperty(key)) {
        sanitized[key] = sanitizeInput(input[key]);
      }
    }
    return sanitized;
  }
  return input;
};

/**
 * Validation middleware for payment requests
 */
const validatePaymentRequest = (req, res, next) => {
  // Sanitize input first
  req.body = sanitizeInput(req.body);
  
  const schema = Joi.object({
    amount: Joi.number().positive().required(),
    label: Joi.string().min(1).max(100).required(),
    message: Joi.string().min(1).max(500).required(),
    memo: Joi.string().max(500),
    customerEmail: Joi.string().email().allow('').optional(),
    web3AuthUserId: Joi.string().required(),
    merchantWallet: Joi.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/).optional(), // Allow merchant wallet for multi-tenant support
    chain: Joi.string().valid('solana', 'ethereum', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'base').default('solana'),
    splToken: Joi.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/).optional()
  });

  const { error, value } = schema.validate(req.body);
  
  if (error) {
    logger.warn('Payment validation failed:', error.details);
    return res.status(400).json({
      error: 'Validation failed',
      details: error.details.map(d => d.message)
    });
  }

  req.body = value;
  next();
};

/**
 * Validation middleware for payment confirmation
 */
const validatePaymentConfirmation = (req, res, next) => {
  // Sanitize input first
  req.body = sanitizeInput(req.body);
  
  const schema = Joi.object({
    reference: Joi.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,88}$/).required(),
    signature: Joi.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/).required()
  });

  const { error, value } = schema.validate(req.body);
  
  if (error) {
    logger.warn('Payment confirmation validation failed:', error.details);
    return res.status(400).json({
      error: 'Validation failed',
      details: error.details.map(d => d.message)
    });
  }

  req.body = value;
  next();
};

/**
 * Validation middleware for user registration
 */
const validateUserCreation = (req, res, next) => {
  // Sanitize input first
  req.body = sanitizeInput(req.body);
  
  const schema = Joi.object({
    web3AuthUserId: Joi.string().required(),
    email: Joi.string().email().optional(),
    solanaAddress: Joi.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/).required(),
    ethereumAddress: Joi.string().regex(/^0x[a-fA-F0-9]{40}$/).required(),
    polygonAddress: Joi.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
    arbitrumAddress: Joi.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
    baseAddress: Joi.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
    optimismAddress: Joi.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
    avalancheAddress: Joi.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()
  });

  const { error, value } = schema.validate(req.body);
  
  if (error) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: error.details.map(d => d.message)
    });
  }

  req.body = value;
  next();
};

/**
 * Validation middleware for user onboarding
 */
const validateUserOnboarding = (req, res, next) => {
  // Sanitize input first
  req.body = sanitizeInput(req.body);
  
  const schema = Joi.object({
    web3AuthUserId: Joi.string().required(),
    firstName: Joi.string().min(1).max(50).required(),
    lastName: Joi.string().min(1).max(50).required(),
    businessName: Joi.string().max(100).optional(),
    phoneNumber: Joi.string().max(20).optional(),
    country: Joi.string().max(50).optional()
  });

  const { error, value } = schema.validate(req.body);
  
  if (error) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: error.details.map(d => d.message)
    });
  }

  req.body = value;
  next();
};

module.exports = {
  validatePaymentRequest,
  validatePaymentConfirmation,
  validateUserCreation,
  validateUserOnboarding
};
