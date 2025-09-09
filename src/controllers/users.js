const database = require('../services/database');
const logger = require('../utils/logger');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * Register or get existing user - single endpoint for user management
 */
const registerUser = asyncHandler(async (req, res) => {
  const { web3AuthUserId, email, solanaAddress, ethereumAddress } = req.body;
  
  // Validate required fields
  if (!web3AuthUserId || !solanaAddress || !ethereumAddress) {
    logger.warn('User registration failed: Missing required fields', {
      web3AuthUserId: !!web3AuthUserId,
      solanaAddress: !!solanaAddress,
      ethereumAddress: !!ethereumAddress
    });
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: web3AuthUserId, solanaAddress, ethereumAddress'
    });
  }
  
  try {
    // Use updated function with correct parameter order
    const { data: user } = await database.getClient()
      .rpc('register_or_get_user', {
        p_web3auth_user_id: web3AuthUserId,
        p_solana_address: solanaAddress,
        p_ethereum_address: ethereumAddress,
        p_email: email || null
      });
    
    const isNewUser = user && user.onboarding_completed === false;
    
    logger.info('User registered/retrieved:', { 
      web3AuthUserId, 
      email: email || 'not provided',
      isNewUser 
    });
    
    res.json({
      success: true,
      user,
      isNewUser
    });
  } catch (error) {
    logger.error('User registration error:', {
      web3AuthUserId,
      email,
      solanaAddress,
      ethereumAddress,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: 'Failed to register user',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Get user profile
 */
const getProfile = asyncHandler(async (req, res) => {
  const { web3AuthUserId } = req.params;
  
  try {
    const user = await database.getUserById(web3AuthUserId);
    
    if (!user) {
      logger.info('User not found for profile request:', { web3AuthUserId });
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    res.json({
      success: true,
      user
    });
  } catch (dbError) {
    logger.error('Error retrieving user profile:', {
      web3AuthUserId,
      error: dbError.message,
      code: dbError.code
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve user profile',
      details: process.env.NODE_ENV === 'development' ? dbError.message : undefined
    });
  }
});

/**
 * Complete user onboarding
 */
const completeOnboarding = asyncHandler(async (req, res) => {
  const { web3AuthUserId, firstName, lastName, businessName, phoneNumber, country } = req.body;
  
  try {
    const user = await database.completeUserOnboarding(web3AuthUserId, {
      first_name: firstName,
      last_name: lastName,
      business_name: businessName,
      phone_number: phoneNumber,
      country
    });
    
    logger.info('User onboarding completed:', { web3AuthUserId });
    
    res.json({
      success: true,
      user
    });
  } catch (dbError) {
    logger.error('Onboarding completion error:', {
      web3AuthUserId,
      firstName,
      lastName,
      error: dbError.message,
      code: dbError.code
    });
    res.status(500).json({
      success: false,
      error: 'Failed to complete onboarding',
      details: process.env.NODE_ENV === 'development' ? dbError.message : undefined
    });
  }
});

/**
 * Check onboarding status
 */
const getOnboardingStatus = asyncHandler(async (req, res) => {
  const { web3AuthUserId } = req.params;
  
  try {
    const status = await database.checkUserOnboardingStatus(web3AuthUserId);
    
    if (!status) {
      logger.info('User not found for onboarding status check:', { web3AuthUserId });
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    res.json({
      success: true,
      onboardingCompleted: status.onboarding_completed || false,
      userInfo: status
    });
  } catch (dbError) {
    logger.error('Onboarding status check error:', {
      web3AuthUserId,
      error: dbError.message,
      code: dbError.code
    });
    res.status(500).json({
      success: false,
      error: 'Failed to check onboarding status',
      details: process.env.NODE_ENV === 'development' ? dbError.message : undefined
    });
  }
});

module.exports = {
  registerUser,
  getProfile,
  completeOnboarding,
  getOnboardingStatus
};
