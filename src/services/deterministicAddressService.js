const { Keypair } = require('@solana/web3.js');
const crypto = require('crypto');
const { derivePath } = require('ed25519-hd-key');
const { Pool } = require('pg');

class DeterministicAddressService {
  constructor() {
    this.PAYMEBRO_PATH_PREFIX = "m/44'/501'/2024'";
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
  }

  /**
   * Generate master seed for user (one-time setup)
   */
  generateUserMasterSeed(userId) {
    const seed = crypto.createHmac('sha256', process.env.MASTER_SEED_SECRET || 'paymebro-secret')
      .update(userId)
      .digest();
    return seed;
  }

  /**
   * Encrypt master seed for storage
   */
  encryptMasterSeed(seed, userId) {
    const cipher = crypto.createCipher('aes-256-cbc', userId + process.env.ENCRYPTION_KEY);
    let encrypted = cipher.update(seed.toString('hex'), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  }

  /**
   * Decrypt master seed from storage
   */
  decryptMasterSeed(encryptedSeed, userId) {
    const decipher = crypto.createDecipher('aes-256-cbc', userId + process.env.ENCRYPTION_KEY);
    let decrypted = decipher.update(encryptedSeed, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return Buffer.from(decrypted, 'hex');
  }

  /**
   * Generate deterministic payment address for user
   */
  async generatePaymentAddress(userId) {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Get or create user payment tracking
      let userTracking = await this.getUserPaymentTracking(userId, client);
      
      if (!userTracking) {
        userTracking = await this.initializeUserTracking(userId, client);
      }

      // Increment payment counter
      const newCounter = userTracking.payment_counter + 1;
      
      // Generate deterministic address
      const masterSeed = this.decryptMasterSeed(userTracking.master_seed_hash, userId);
      const derivationPath = `${this.PAYMEBRO_PATH_PREFIX}/${userId}/0/${newCounter}`;
      
      const derivedSeed = derivePath(derivationPath, masterSeed.toString('hex')).key;
      const keypair = Keypair.fromSeed(derivedSeed);
      const address = keypair.publicKey.toString();

      // Update counter in database
      await client.query(
        'UPDATE user_payment_tracking SET payment_counter = $1, total_payments = $2, updated_at = CURRENT_TIMESTAMP WHERE web3auth_user_id = $3',
        [newCounter, userTracking.total_payments + 1, userId]
      );

      await client.query('COMMIT');

      return {
        address,
        counter: newCounter,
        derivationPath,
        userId
      };

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get user payment tracking data
   */
  async getUserPaymentTracking(userId, client = null) {
    const queryClient = client || this.pool;
    
    const result = await queryClient.query(
      'SELECT * FROM user_payment_tracking WHERE web3auth_user_id = $1',
      [userId]
    );

    return result.rows[0] || null;
  }

  /**
   * Initialize user tracking (first time setup)
   */
  async initializeUserTracking(userId, client = null) {
    const queryClient = client || this.pool;
    
    const masterSeed = this.generateUserMasterSeed(userId);
    const encryptedSeed = this.encryptMasterSeed(masterSeed, userId);

    const result = await queryClient.query(
      `INSERT INTO user_payment_tracking (web3auth_user_id, payment_counter, master_seed_hash, total_payments)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (web3auth_user_id) DO NOTHING
       RETURNING *`,
      [userId, 0, encryptedSeed, 0]
    );

    return result.rows[0] || await this.getUserPaymentTracking(userId, queryClient);
  }

  /**
   * Get user payment count for plan enforcement
   */
  async getUserPaymentCount(userId) {
    const tracking = await this.getUserPaymentTracking(userId);
    return tracking ? tracking.total_payments : 0;
  }

  /**
   * Generate address range for transaction history
   */
  async generateUserAddressRange(userId, startIndex = 0, endIndex = null) {
    const tracking = await this.getUserPaymentTracking(userId);
    if (!tracking) return [];

    const masterSeed = this.decryptMasterSeed(tracking.master_seed_hash, userId);
    const maxIndex = endIndex || tracking.payment_counter;
    const addresses = [];

    for (let i = startIndex; i <= maxIndex; i++) {
      const derivationPath = `${this.PAYMEBRO_PATH_PREFIX}/${userId}/0/${i}`;
      const derivedSeed = derivePath(derivationPath, masterSeed.toString('hex')).key;
      const keypair = Keypair.fromSeed(derivedSeed);
      
      addresses.push({
        address: keypair.publicKey.toString(),
        counter: i,
        derivationPath
      });
    }

    return addresses;
  }

  /**
   * Check if user can create more payments (plan enforcement)
   */
  async canUserCreatePayment(userId, userPlan = 'free') {
    const tracking = await this.getUserPaymentTracking(userId);
    if (!tracking) return true; // New users can create payments

    // Get current month's payment count
    const monthlyCount = await this.getMonthlyPaymentCount(userId);
    
    // Plan limits
    const planLimits = {
      free: 100,
      pro: 1000,
      enterprise: Infinity
    };

    const limit = planLimits[userPlan] || planLimits.free;
    return monthlyCount < limit;
  }

  /**
   * Get user's payment count for current month
   */
  async getMonthlyPaymentCount(userId) {
    const client = await this.pool.connect();
    
    try {
      const currentMonth = new Date();
      const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
      const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0, 23, 59, 59);

      const result = await client.query(
        `SELECT COUNT(*) as count FROM payments 
         WHERE web3auth_user_id = $1 
         AND created_at >= $2 
         AND created_at <= $3`,
        [userId, startOfMonth, endOfMonth]
      );

      return parseInt(result.rows[0].count) || 0;
    } finally {
      client.release();
    }
  }

  /**
   * Get user plan from database or default to free
   */
  async getUserPlan(userId) {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(
        'SELECT plan_type FROM users WHERE web3auth_user_id = $1',
        [userId]
      );

      return result.rows[0]?.plan_type || 'free';
    } catch (error) {
      console.error('Error fetching user plan:', error);
      return 'free'; // Default to free on error
    } finally {
      client.release();
    }
  }
}

module.exports = DeterministicAddressService;
