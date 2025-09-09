/**
 * Database service for interacting with Supabase
 * 
 * This service provides methods for interacting with the Supabase database,
 * including user management, payment tracking, and transaction logging.
 * 
 * The service uses Web3Auth user IDs as the primary identifier for cross-chain support.
 * 
 * Features:
 * - User registration and management
 * - Payment creation and tracking
 * - Transaction logging
 * - Onboarding status tracking
 * 
 * Security:
 * - Error logging with sensitive data filtered
 * - Input validation through database constraints
 * - Row Level Security (RLS) policies
 * 
 * @module database
 */

const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

/**
 * Supabase database service for multi-chain payment and user management
 * Uses Web3Auth user ID as primary identifier for cross-chain support
 */
class DatabaseService {
  constructor() {
    this.supabase = null;
  }

  /**
   * Initialize Supabase client (lazy loading)
   * 
   * @returns {Object} Supabase client instance
   * @throws {Error} If SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables are missing
   */
  getClient() {
    if (!this.supabase) {
      if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
      }
      
      this.supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
      );
    }
    return this.supabase;
  }

  /**
   * Create a new payment record
   * 
   * @param {Object} paymentData - Payment data to insert
   * @param {string} paymentData.reference - Unique payment reference
   * @param {string} paymentData.web3auth_user_id - Web3Auth user ID
   * @param {string} paymentData.amount - Payment amount
   * @param {string} paymentData.currency - Payment currency (SOL, USDC, etc.)
   * @returns {Promise<Object>} Created payment record
   * @throws {Error} If database operation fails
   */
  async createPayment(paymentData) {
    const { data, error } = await this.getClient()
      .from('payments')
      .insert(paymentData)
      .select()
      .single();

    if (error) {
      logger.error('Database error creating payment:', {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        paymentData: {
          reference: paymentData.reference,
          web3auth_user_id: paymentData.web3auth_user_id,
          amount: paymentData.amount,
          currency: paymentData.currency
        }
      });
      const dbError = new Error(`Failed to create payment: ${error.message}`);
      dbError.code = error.code;
      dbError.details = error.details;
      throw dbError;
    }

    return data;
  }

  /**
   * Get payment by reference
   * 
   * @param {string} reference - Payment reference ID
   * @returns {Promise<Object|null>} Payment record or null if not found
   * @throws {Error} If database operation fails
   */
  async getPayment(reference) {
    const { data, error } = await this.getClient()
      .from('payments')
      .select('id, reference, web3auth_user_id, amount, currency, chain, recipient_address, label, message, memo, status, transaction_signature, customer_email, spl_token_mint, created_at, updated_at')
      .eq('reference', reference)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error('Database error getting payment:', {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        reference
      });
      const dbError = new Error(`Failed to get payment: ${error.message}`);
      dbError.code = error.code;
      dbError.details = error.details;
      throw dbError;
    }

    return data;
  }

  /**
   * Update payment status
   * 
   * @param {string} reference - Payment reference ID
   * @param {string} status - New payment status
   * @param {string} [transactionSignature] - Transaction signature (optional)
   * @returns {Promise<Object>} Updated payment record
   * @throws {Error} If database operation fails
   */
  async updatePaymentStatus(reference, status, transactionSignature = null) {
    const updateData = { 
      status, 
      updated_at: new Date().toISOString() 
    };
    
    if (transactionSignature) {
      updateData.transaction_signature = transactionSignature;
    }

    const { data, error } = await this.getClient()
      .from('payments')
      .update(updateData)
      .eq('reference', reference)
      .select()
      .single();

    if (error) {
      logger.error('Database error updating payment:', {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        reference,
        status,
        transactionSignature
      });
      const dbError = new Error(`Failed to update payment: ${error.message}`);
      dbError.code = error.code;
      dbError.details = error.details;
      throw dbError;
    }

    return data;
  }

  /**
   * Get user by Web3Auth user ID (primary identifier for multi-chain)
   * 
   * @param {string} web3AuthUserId - Web3Auth user ID
   * @returns {Promise<Object|null>} User record or null if not found
   * @throws {Error} If database operation fails
   */
  async getUserById(web3AuthUserId) {
    const { data, error } = await this.getClient()
      .from('users')
      .select('id, web3auth_user_id, email, solana_address, ethereum_address, polygon_address, arbitrum_address, optimism_address, avalanche_address, first_name, last_name, business_name, phone_number, country, onboarding_completed, created_at, updated_at')
      .eq('web3auth_user_id', web3AuthUserId)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error('Database error getting user:', {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        web3AuthUserId
      });
      const dbError = new Error(`Failed to get user: ${error.message}`);
      dbError.code = error.code;
      dbError.details = error.details;
      throw dbError;
    }

    return data;
  }

  /**
   * Create or update user with multi-chain addresses
   * 
   * @param {Object} userData - User data to upsert
   * @param {string} userData.web3auth_user_id - Web3Auth user ID
   * @param {string} userData.email - User email (optional)
   * @param {string} userData.solana_address - Solana wallet address
   * @param {string} userData.ethereum_address - Ethereum wallet address
   * @returns {Promise<Object>} Upserted user record
   * @throws {Error} If database operation fails
   */
  async upsertUser(userData) {
    const { data, error } = await this.getClient()
      .from('users')
      .upsert(userData, { onConflict: 'web3auth_user_id' })
      .select()
      .single();

    if (error) {
      logger.error('Database error upserting user:', {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        userData: {
          web3auth_user_id: userData.web3auth_user_id,
          email: userData.email,
          solana_address: userData.solana_address
        }
      });
      const dbError = new Error(`Failed to upsert user: ${error.message}`);
      dbError.code = error.code;
      dbError.details = error.details;
      throw dbError;
    }

    return data;
  }

  /**
   * Update user with onboarding information
   * 
   * @param {string} web3AuthUserId - Web3Auth user ID
   * @param {Object} onboardingData - Onboarding data
   * @param {string} onboardingData.first_name - User's first name
   * @param {string} onboardingData.last_name - User's last name
   * @param {string} [onboardingData.business_name] - Business name (optional)
   * @param {string} [onboardingData.phone_number] - Phone number (optional)
   * @param {string} [onboardingData.country] - Country (optional)
   * @returns {Promise<Object>} Updated user record
   * @throws {Error} If database operation fails
   */
  async completeUserOnboarding(web3AuthUserId, onboardingData) {
    const { data, error } = await this.getClient()
      .from('users')
      .update({
        ...onboardingData,
        onboarding_completed: true,
        updated_at: new Date().toISOString()
      })
      .eq('web3auth_user_id', web3AuthUserId)
      .select()
      .single();

    if (error) {
      logger.error('Database error completing user onboarding:', {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        web3AuthUserId,
        onboardingData: {
          first_name: onboardingData.first_name,
          last_name: onboardingData.last_name,
          business_name: onboardingData.business_name
        }
      });
      const dbError = new Error(`Failed to complete user onboarding: ${error.message}`);
      dbError.code = error.code;
      dbError.details = error.details;
      throw dbError;
    }

    return data;
  }

  /**
   * Check if user has completed onboarding
   * 
   * @param {string} web3AuthUserId - Web3Auth user ID
   * @returns {Promise<Object|null>} Onboarding status or null if user not found
   * @throws {Error} If database operation fails
   */
  async checkUserOnboardingStatus(web3AuthUserId) {
    const { data, error } = await this.getClient()
      .from('users')
      .select('onboarding_completed, first_name, last_name, business_name')
      .eq('web3auth_user_id', web3AuthUserId)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error('Database error checking onboarding status:', {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        web3AuthUserId
      });
      const dbError = new Error(`Failed to check onboarding status: ${error.message}`);
      dbError.code = error.code;
      dbError.details = error.details;
      throw dbError;
    }

    return data;
  }
}

module.exports = new DatabaseService();
