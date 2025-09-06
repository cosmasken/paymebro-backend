const logger = require('../utils/logger');

/**
 * Simple API key authentication for admin endpoints
 */
const authenticateAdmin = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  
  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: 'API key required'
    });
  }

  if (apiKey !== process.env.ADMIN_API_KEY) {
    logger.warn('Invalid API key attempt:', { ip: req.ip, userAgent: req.get('User-Agent') });
    return res.status(403).json({
      success: false,
      error: 'Invalid API key'
    });
  }

  next();
};

/**
 * Web3Auth user validation middleware
 */
const validateWeb3AuthUser = (req, res, next) => {
  const { web3AuthUserId } = req.body;
  
  if (!web3AuthUserId) {
    return res.status(400).json({
      success: false,
      error: 'Web3Auth user ID required'
    });
  }

  // Add user ID to request for downstream use
  req.web3AuthUserId = web3AuthUserId;
  next();
};

module.exports = {
  authenticateAdmin,
  validateWeb3AuthUser
};
