const { PublicKey } = require('@solana/web3.js');
const database = require('../services/database');
const logger = require('../utils/logger');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * Register a new user
 */
const registerUser = asyncHandler(async (req, res) => {
  const { web3auth_user_id, email, name, solana_address, ethereum_address } = req.body;

  try {
    // Check if user already exists
    const existingUser = await database.getUserById(web3auth_user_id);

    if (existingUser) {
      return res.json({
        success: true,
        user: existingUser,
        isNewUser: false
      });
    }

    // Create new user data object
    const userData = {
      web3auth_user_id,
      email: email || null,
      solana_address: solana_address || null,
      ethereum_address: ethereum_address || null,
      onboarding_completed: false
    };

    // If name is provided, split it into first and last name
    if (name) {
      const nameParts = name.trim().split(' ');
      userData.first_name = nameParts[0];
      userData.last_name = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
    }

    // Create user using existing upsertUser function
    const newUser = await database.upsertUser(userData);

    // Auto-create default merchant address if solana_address is provided
    if (solana_address && !existingUser) {
      try {
        await database.addMerchantAddress(
          web3auth_user_id,
          solana_address,
          'Default Wallet',
          'solana',
          true // Set as default
        );
        logger.info('Default merchant address created for new user:', {
          web3auth_user_id,
          address: solana_address
        });
      } catch (addressError) {
        // Log error but don't fail registration
        logger.warn('Failed to create default merchant address:', {
          web3auth_user_id,
          error: addressError.message
        });
      }
    }

    logger.info('User registered successfully:', {
      web3auth_user_id,
      email: email || 'not provided',
      hasName: !!name
    });

    res.status(201).json({
      success: true,
      user: newUser,
      isNewUser: true
    });
  } catch (error) {
    logger.error('Failed to register user:', {
      web3auth_user_id,
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to register user'
    });
  }
});

/**
 * Get user profile
 */
const getUserProfile = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await database.getUserById(userId);

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
  } catch (error) {
    logger.error('Failed to get user profile:', {
      userId,
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to get user profile'
    });
  }
});

/**
 * Update user profile
 */
const updateUserProfile = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { businessName, businessType, defaultReceivingAddress } = req.body;

  try {
    const updates = {};
    if (businessName !== undefined) updates.business_name = businessName;
    if (businessType !== undefined) updates.business_type = businessType;
    if (defaultReceivingAddress !== undefined) updates.default_receiving_address = defaultReceivingAddress;

    const updatedUser = await database.updateUser(userId, updates);

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      user: updatedUser
    });
  } catch (error) {
    logger.error('Failed to update user profile:', {
      userId,
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to update user profile'
    });
  }
});

/**
 * Get user merchant addresses
 */
const getUserAddresses = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  try {
    const addresses = await database.getUserMerchantAddresses(userId);

    res.json({
      success: true,
      addresses
    });
  } catch (error) {
    logger.error('Failed to get user addresses:', {
      userId,
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to get user addresses'
    });
  }
});

/**
 * Add new merchant address
 */
const addUserAddress = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { address, label, network, is_default } = req.body;

  // Validate required fields
  if (!address || !label || !network) {
    return res.status(400).json({
      success: false,
      error: 'Address, label, and network are required'
    });
  }

  // Validate address format
  try {
    if (network === 'solana') {
      new PublicKey(address); // This will throw if invalid
    } else if (network === 'ethereum' || network === 'polygon') {
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        throw new Error('Invalid Ethereum address format');
      }
    }
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address format for the specified network'
    });
  }

  try {
    // Check if address already exists for this user
    const existingAddresses = await database.getUserMerchantAddresses(userId);
    const addressExists = existingAddresses.some(addr =>
      addr.address.toLowerCase() === address.toLowerCase() && addr.network === network
    );

    if (addressExists) {
      return res.status(400).json({
        success: false,
        error: 'Address already exists for this network'
      });
    }

    const newAddress = await database.addMerchantAddress(userId, address, label, network, is_default);

    res.json({
      success: true,
      address: newAddress
    });
  } catch (error) {
    logger.error('Failed to add user address:', {
      userId,
      address,
      network,
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to add address'
    });
  }
});

/**
 * Update merchant address
 */
const updateUserAddress = asyncHandler(async (req, res) => {
  const { userId, addressId } = req.params;
  const { label, is_default } = req.body;

  try {
    const updates = {};
    if (label !== undefined) updates.label = label;
    if (is_default !== undefined) updates.is_default = is_default;

    const updatedAddress = await database.updateMerchantAddress(addressId, updates);

    if (!updatedAddress) {
      return res.status(404).json({
        success: false,
        error: 'Address not found'
      });
    }

    res.json({
      success: true,
      address: updatedAddress
    });
  } catch (error) {
    logger.error('Failed to update user address:', {
      userId,
      addressId,
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to update address'
    });
  }
});

/**
 * Delete merchant address
 */
const deleteUserAddress = asyncHandler(async (req, res) => {
  const { userId, addressId } = req.params;

  try {
    const deleted = await database.deleteMerchantAddress(addressId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Address not found'
      });
    }

    res.json({
      success: true,
      message: 'Address deleted successfully'
    });
  } catch (error) {
    logger.error('Failed to delete user address:', {
      userId,
      addressId,
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to delete address'
    });
  }
});

/**
 * Set default merchant address
 */
const setDefaultUserAddress = asyncHandler(async (req, res) => {
  const { userId, addressId } = req.params;

  try {
    const success = await database.setDefaultMerchantAddress(userId, addressId);

    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'Address not found'
      });
    }

    res.json({
      success: true,
      message: 'Default address updated successfully'
    });
  } catch (error) {
    logger.error('Failed to set default address:', {
      userId,
      addressId,
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to set default address'
    });
  }
});

/**
 * Validate address format
 */
const validateAddress = asyncHandler(async (req, res) => {
  const { address, network } = req.body;

  if (!address || !network) {
    return res.status(400).json({
      success: false,
      error: 'Address and network are required'
    });
  }

  try {
    let valid = false;
    let error = null;

    if (network === 'solana') {
      try {
        new PublicKey(address);
        valid = true;
      } catch (err) {
        error = 'Invalid Solana address format';
      }
    } else if (network === 'ethereum' || network === 'polygon') {
      if (/^0x[a-fA-F0-9]{40}$/.test(address)) {
        valid = true;
      } else {
        error = 'Invalid Ethereum address format';
      }
    } else {
      error = 'Unsupported network';
    }

    res.json({
      success: true,
      valid,
      error
    });
  } catch (error) {
    logger.error('Address validation error:', {
      address,
      network,
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to validate address'
    });
  }
});

module.exports = {
  registerUser,
  getUserProfile,
  updateUserProfile,
  getUserAddresses,
  addUserAddress,
  updateUserAddress,
  deleteUserAddress,
  setDefaultUserAddress,
  validateAddress
};