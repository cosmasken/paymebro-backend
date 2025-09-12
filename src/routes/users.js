const express = require('express');
const router = express.Router();
const {
  registerUser,
  getUserProfile,
  updateUserProfile,
  getUserAddresses,
  addUserAddress,
  updateUserAddress,
  deleteUserAddress,
  setDefaultUserAddress,
  validateAddress
} = require('../controllers/users');
const { validateUserRegistration, validateUserRequest, validateAddressRequest } = require('../middleware/validation');

/**
 * Register new user
 */
router.post('/register', validateUserRegistration, registerUser);

/**
 * Get user profile
 */
router.get('/profile/:userId', getUserProfile);

/**
 * Update user profile
 */
router.put('/profile/:userId', validateUserRequest, updateUserProfile);

/**
 * Get user merchant addresses
 */
router.get('/:userId/addresses', getUserAddresses);

/**
 * Add new merchant address
 */
router.post('/:userId/addresses', validateAddressRequest, addUserAddress);

/**
 * Update merchant address
 */
router.put('/:userId/addresses/:addressId', updateUserAddress);

/**
 * Delete merchant address
 */
router.delete('/:userId/addresses/:addressId', deleteUserAddress);

/**
 * Set default merchant address
 */
router.post('/:userId/addresses/:addressId/set-default', setDefaultUserAddress);

/**
 * Validate address
 */
router.post('/addresses/validate', validateAddress);

module.exports = router;