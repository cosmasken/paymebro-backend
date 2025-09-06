const Joi = require('joi');
const logger = require('../utils/logger');

/**
 * Validation middleware for payment requests
 */
const validatePaymentRequest = (req, res, next) => {
  const schema = Joi.object({
    amount: Joi.number().positive().required(),
    label: Joi.string().min(1).max(100).required(),
    message: Joi.string().min(1).max(500).required(),
    memo: Joi.string().max(500),
    customerEmail: Joi.string().email(),
    web3AuthUserId: Joi.string().required(),
    chain: Joi.string().valid('solana', 'ethereum', 'polygon', 'arbitrum', 'optimism', 'avalanche').default('solana')
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
  const schema = Joi.object({
    reference: Joi.string().required(),
    signature: Joi.string().required()
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

module.exports = {
  validatePaymentRequest,
  validatePaymentConfirmation
};
