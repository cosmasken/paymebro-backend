const express = require('express');
const router = express.Router();
const { 
  registerUser,
  getProfile,
  completeOnboarding, 
  getOnboardingStatus 
} = require('../controllers/users');
const { 
  validateUserCreation, 
  validateUserOnboarding 
} = require('../middleware/validation');
const { authLimiter } = require('../middleware/rateLimiting');

/**
 * Register new user or get existing user
 */
router.post('/register', authLimiter, validateUserCreation, registerUser);

/**
 * Get user profile by web3AuthUserId
 */
router.get('/profile/:web3AuthUserId', getProfile);

/**
 * Get user by ID (alias for profile)
 */
router.get('/:userId', (req, res) => {
  req.params.web3AuthUserId = req.params.userId;
  getProfile(req, res);
});

/**
 * Complete user onboarding
 */
router.post('/onboarding/complete', authLimiter, validateUserOnboarding, completeOnboarding);

/**
 * Get onboarding status
 */
router.get('/onboarding/status/:web3AuthUserId', getOnboardingStatus);

module.exports = router;
