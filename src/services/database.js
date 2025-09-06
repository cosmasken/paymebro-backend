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
   */
  async createPayment(paymentData) {
    const { data, error } = await this.getClient()
      .from('payments')
      .insert(paymentData)
      .select()
      .single();

    if (error) {
      logger.error('Database error creating payment:', error);
      throw new Error('Failed to create payment');
    }

    return data;
  }

  /**
   * Get payment by reference
   */
  async getPayment(reference) {
    const { data, error } = await this.getClient()
      .from('payments')
      .select('*')
      .eq('reference', reference)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error('Database error getting payment:', error);
      throw new Error('Failed to get payment');
    }

    return data;
  }

  /**
   * Update payment status
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
      logger.error('Database error updating payment:', error);
      throw new Error('Failed to update payment');
    }

    return data;
  }

  /**
   * Get user by Web3Auth user ID (primary identifier for multi-chain)
   */
  async getUserById(web3AuthUserId) {
    const { data, error } = await this.getClient()
      .from('users')
      .select('*')
      .eq('web3auth_user_id', web3AuthUserId)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error('Database error getting user:', error);
      throw new Error('Failed to get user');
    }

    return data;
  }

  /**
   * Create or update user with multi-chain addresses
   */
  async upsertUser(userData) {
    const { data, error } = await this.getClient()
      .from('users')
      .upsert(userData, { onConflict: 'web3auth_user_id' })
      .select()
      .single();

    if (error) {
      logger.error('Database error upserting user:', error);
      throw new Error('Failed to upsert user');
    }

    return data;
  }
}

module.exports = new DatabaseService();
