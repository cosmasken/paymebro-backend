const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { asyncHandler } = require('../middleware/errorHandler');
const database = require('../services/database');
const logger = require('../utils/logger');

/**
 * Validation for user creation
 */
const validateUserCreation = (req, res, next) => {
  const schema = Joi.object({
    web3AuthUserId: Joi.string().required(),
    email: Joi.string().email(),
    solanaAddress: Joi.string().required(),
    ethereumAddress: Joi.string().required(),
    polygonAddress: Joi.string(),
    arbitrumAddress: Joi.string(),
    optimismAddress: Joi.string(),
    avalancheAddress: Joi.string()
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
 * Create or update user with multi-chain addresses
 */
const createUser = asyncHandler(async (req, res) => {
  const { 
    web3AuthUserId, 
    email, 
    solanaAddress, 
    ethereumAddress,
    polygonAddress,
    arbitrumAddress,
    optimismAddress,
    avalancheAddress
  } = req.body;
  
  const userData = {
    web3auth_user_id: web3AuthUserId,
    email,
    solana_address: solanaAddress,
    ethereum_address: ethereumAddress,
    polygon_address: polygonAddress || ethereumAddress,
    arbitrum_address: arbitrumAddress || ethereumAddress,
    optimism_address: optimismAddress || ethereumAddress,
    avalanche_address: avalancheAddress || ethereumAddress
  };

  const user = await database.upsertUser(userData);
  
  logger.info('User created/updated:', { web3AuthUserId, email });

  res.json({
    success: true,
    user
  });
});

/**
 * Get user by Web3Auth ID
 */
const getUser = asyncHandler(async (req, res) => {
  const { web3AuthUserId } = req.params;
  const user = await database.getUserById(web3AuthUserId);
  
  if (!user) {
    return res.status(404).json({
      success: false,
      error: 'User not found'
    });
  }

  res.json({
    success: true,
    user
  });
});

router.post('/create', validateUserCreation, createUser);
router.get('/:web3AuthUserId', getUser);

module.exports = router;
