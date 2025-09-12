/**
 * Address Resolution Service
 * 
 * This service handles dynamic merchant address resolution with a hierarchical approach:
 * 1. Payment-specific address (highest priority)
 * 2. User default address
 * 3. Global merchant address (environment variable)
 * 4. Hardcoded fallback address
 * 
 * Features:
 * - Solana address validation
 * - Backward compatibility with existing static addresses
 * - Comprehensive error handling and fallbacks
 * 
 * @module addressResolutionService
 */

const { PublicKey } = require('@solana/web3.js');
const database = require('./database');
const logger = require('../utils/logger');

class AddressResolutionService {
    constructor() {
        // Hardcoded fallback address for absolute fallback scenarios
        this.FALLBACK_ADDRESS = 'GDBPQ6G7k9xMFcmz2GqEgmcesC6DRzeWQPfRPk1hQNBo';
    }

    /**
     * Resolve recipient address using hierarchical approach
     * 
     * @param {string} userId - Web3Auth user ID
     * @param {string|null} customAddress - Optional payment-specific address
     * @returns {Promise<Object>} Resolved address information
     * @throws {Error} If no valid address can be resolved
     */
    async resolveRecipientAddress(userId, customAddress = null) {
        try {
            logger.info('Resolving recipient address', { userId, hasCustomAddress: !!customAddress });

            // 1. Payment-specific address (highest priority)
            if (customAddress) {
                if (await this.validateSolanaAddress(customAddress)) {
                    logger.info('Using payment-specific address', { userId, address: customAddress });
                    return {
                        address: customAddress,
                        resolvedFrom: 'custom',
                        isValid: true
                    };
                } else {
                    throw new Error(`Invalid payment-specific address: ${customAddress}`);
                }
            }

            // 2. User default address
            const userDefaultAddress = await this.getUserDefaultAddress(userId);
            if (userDefaultAddress) {
                if (await this.validateSolanaAddress(userDefaultAddress)) {
                    logger.info('Using user default address', { userId, address: userDefaultAddress });
                    return {
                        address: userDefaultAddress,
                        resolvedFrom: 'user_default',
                        isValid: true
                    };
                } else {
                    logger.warn('User default address is invalid, falling back', {
                        userId,
                        invalidAddress: userDefaultAddress
                    });
                }
            }

            // 3. Global merchant address (environment variable)
            const globalAddress = this.getGlobalMerchantAddress();
            if (globalAddress) {
                if (await this.validateSolanaAddress(globalAddress)) {
                    logger.info('Using global merchant address', { userId, address: globalAddress });
                    return {
                        address: globalAddress,
                        resolvedFrom: 'global',
                        isValid: true
                    };
                } else {
                    logger.warn('Global merchant address is invalid, falling back', {
                        invalidAddress: globalAddress
                    });
                }
            }

            // 4. Hardcoded fallback address
            if (await this.validateSolanaAddress(this.FALLBACK_ADDRESS)) {
                logger.warn('Using hardcoded fallback address', {
                    userId,
                    address: this.FALLBACK_ADDRESS
                });
                return {
                    address: this.FALLBACK_ADDRESS,
                    resolvedFrom: 'fallback',
                    isValid: true
                };
            }

            // If we reach here, no valid address could be resolved
            throw new Error('No valid recipient address could be resolved');

        } catch (error) {
            logger.error('Failed to resolve recipient address', {
                userId,
                hasCustomAddress: !!customAddress,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Validate Solana address format
     * 
     * @param {string} address - Address to validate
     * @returns {Promise<boolean>} True if valid Solana address
     */
    async validateSolanaAddress(address) {
        try {
            if (!address || typeof address !== 'string') {
                return false;
            }

            // Trim whitespace
            address = address.trim();

            // Check basic format requirements
            if (address.length < 32 || address.length > 44) {
                return false;
            }

            // Check if it's a valid base58 string by trying to create a PublicKey
            new PublicKey(address);

            return true;
        } catch (error) {
            // PublicKey constructor throws if invalid
            return false;
        }
    }

    /**
     * Get user's default receiving address
     * 
     * @param {string} userId - Web3Auth user ID
     * @returns {Promise<string|null>} User's default address or null
     */
    async getUserDefaultAddress(userId) {
        try {
            if (!userId) {
                return null;
            }

            // First check if user has a default_receiving_address in users table
            const { data: userData, error: userError } = await database.getClient()
                .from('users')
                .select('default_receiving_address')
                .eq('web3auth_user_id', userId)
                .single();

            if (userError && userError.code !== 'PGRST116') { // PGRST116 = no rows returned
                logger.error('Error fetching user default address from users table', {
                    userId,
                    error: userError.message
                });
            }

            if (userData?.default_receiving_address) {
                return userData.default_receiving_address;
            }

            // If no default in users table, check merchant_addresses table for default address
            // Note: This assumes the merchant_addresses table exists (will be created in task 1)
            try {
                const { data: addressData, error: addressError } = await database.getClient()
                    .from('merchant_addresses')
                    .select('address')
                    .eq('web3auth_user_id', userId)
                    .eq('is_default', true)
                    .single();

                if (addressError && addressError.code !== 'PGRST116') {
                    logger.error('Error fetching user default address from merchant_addresses table', {
                        userId,
                        error: addressError.message
                    });
                }

                return addressData?.address || null;
            } catch (error) {
                // merchant_addresses table might not exist yet (task 1 not completed)
                logger.debug('merchant_addresses table not available, skipping', { userId });
                return null;
            }

        } catch (error) {
            logger.error('Failed to get user default address', {
                userId,
                error: error.message
            });
            return null;
        }
    }

    /**
     * Get global merchant address from environment variable
     * 
     * @returns {string|null} Global merchant address or null
     */
    getGlobalMerchantAddress() {
        return process.env.MERCHANT_WALLET_ADDRESS || null;
    }

    /**
     * Validate address and provide detailed error information
     * 
     * @param {string} address - Address to validate
     * @returns {Promise<Object>} Validation result with details
     */
    async validateAddressWithDetails(address) {
        try {
            if (address === null || address === undefined || typeof address !== 'string') {
                return {
                    isValid: false,
                    error: 'Address is required and must be a string',
                    errorCode: 'INVALID_FORMAT'
                };
            }

            const trimmedAddress = address.trim();

            if (trimmedAddress.length === 0) {
                return {
                    isValid: false,
                    error: 'Address cannot be empty',
                    errorCode: 'EMPTY_ADDRESS'
                };
            }

            // Check for common non-Solana address patterns first (before length checks)
            if (trimmedAddress.startsWith('0x')) {
                return {
                    isValid: false,
                    error: 'This appears to be an Ethereum address. Please provide a Solana address.',
                    errorCode: 'WRONG_NETWORK'
                };
            }

            if (trimmedAddress.includes(' ')) {
                return {
                    isValid: false,
                    error: 'Address cannot contain spaces',
                    errorCode: 'INVALID_CHARACTERS'
                };
            }

            if (trimmedAddress.length < 32) {
                return {
                    isValid: false,
                    error: 'Address is too short (minimum 32 characters)',
                    errorCode: 'TOO_SHORT'
                };
            }

            if (trimmedAddress.length > 44) {
                return {
                    isValid: false,
                    error: 'Address is too long (maximum 44 characters)',
                    errorCode: 'TOO_LONG'
                };
            }

            // Try to create PublicKey to validate base58 format
            try {
                new PublicKey(trimmedAddress);
                return {
                    isValid: true,
                    address: trimmedAddress,
                    errorCode: null,
                    error: null
                };
            } catch (error) {
                return {
                    isValid: false,
                    error: 'Invalid Solana address format',
                    errorCode: 'INVALID_BASE58'
                };
            }

        } catch (error) {
            return {
                isValid: false,
                error: 'Unexpected error during validation',
                errorCode: 'VALIDATION_ERROR'
            };
        }
    }

    /**
     * Check if an address is likely from a different blockchain network
     * 
     * @param {string} address - Address to check
     * @returns {Object} Network detection result
     */
    detectAddressNetwork(address) {
        if (!address || typeof address !== 'string') {
            return { network: 'unknown', confidence: 0 };
        }

        const trimmedAddress = address.trim();

        // Ethereum-style addresses
        if (trimmedAddress.startsWith('0x') && trimmedAddress.length === 42) {
            return { network: 'ethereum', confidence: 0.9 };
        }

        // Bitcoin-style addresses
        if (trimmedAddress.match(/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/)) {
            return { network: 'bitcoin', confidence: 0.8 };
        }

        if (trimmedAddress.match(/^bc1[a-z0-9]{39,59}$/)) {
            return { network: 'bitcoin', confidence: 0.9 };
        }

        // Solana addresses are typically 32-44 characters, base58 encoded
        if (trimmedAddress.length >= 32 && trimmedAddress.length <= 44) {
            try {
                new PublicKey(trimmedAddress);
                return { network: 'solana', confidence: 0.9 };
            } catch {
                return { network: 'unknown', confidence: 0.1 };
            }
        }

        return { network: 'unknown', confidence: 0 };
    }

    /**
     * Get address resolution statistics for monitoring
     * 
     * @param {string} userId - Web3Auth user ID
     * @returns {Promise<Object>} Address resolution statistics
     */
    async getAddressResolutionStats(userId) {
        try {
            const stats = {
                hasUserDefault: false,
                hasGlobalMerchant: false,
                hasFallback: true,
                userDefaultValid: false,
                globalMerchantValid: false,
                fallbackValid: false
            };

            // Check user default address
            const userDefault = await this.getUserDefaultAddress(userId);
            if (userDefault) {
                stats.hasUserDefault = true;
                stats.userDefaultValid = await this.validateSolanaAddress(userDefault);
            }

            // Check global merchant address
            const globalAddress = this.getGlobalMerchantAddress();
            if (globalAddress) {
                stats.hasGlobalMerchant = true;
                stats.globalMerchantValid = await this.validateSolanaAddress(globalAddress);
            }

            // Check fallback address
            stats.fallbackValid = await this.validateSolanaAddress(this.FALLBACK_ADDRESS);

            return stats;
        } catch (error) {
            logger.error('Failed to get address resolution stats', {
                userId,
                error: error.message
            });
            return null;
        }
    }
}

module.exports = new AddressResolutionService();