const { findReference, validateTransfer, FindReferenceError } = require('@solana/pay');
const { establishConnection } = require('../modules/solana-payment-merchant-flow/establishConnection');
const { MERCHANT_WALLET } = require('../modules/solana-payment-merchant-flow/constants');
const { PublicKey } = require('@solana/web3.js');
const BigNumber = require('bignumber.js');
const database = require('./database');
const emailService = require('./emailService');
const { sendWebhook } = require('../controllers/webhooks');
const { notifyPaymentUpdate } = require('./websocket');
const logger = require('../utils/logger');

class PaymentMonitor {
  constructor() {
    this.connection = null;
    this.monitoringInterval = null;
  }

  /**
   * Get or create connection
   */
  async getConnection() {
    if (!this.connection) {
      this.connection = await establishConnection();
    }
    return this.connection;
  }

  /**
   * Start monitoring pending payments
   */
  startMonitoring() {
    if (this.monitoringInterval) return;
    
    this.monitoringInterval = setInterval(async () => {
      await this.checkPendingPayments();
    }, 15000); // Check every 15 seconds
    
    logger.info('Payment monitoring started');
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      logger.info('Payment monitoring stopped');
    }
  }

  /**
   * Check all pending payments for confirmation
   */
  async checkPendingPayments() {
    try {
      // Get all pending payments from database
      const { data: pendingPayments } = await database.getClient()
        .from('payments')
        .select('*')
        .eq('status', 'pending');

      if (!pendingPayments || pendingPayments.length === 0) return;

      for (const payment of pendingPayments) {
        await this.checkPaymentConfirmation(payment);
      }
    } catch (error) {
      logger.error('Error checking pending payments:', error);
    }
  }

  /**
   * Check if a specific payment is confirmed on-chain
   */
  async checkPaymentConfirmation(payment) {
    try {
      const connection = await this.getConnection();
      const referencePublicKey = new PublicKey(payment.reference);
      
      // Use findReference from @solana/pay
      const signatureInfo = await findReference(
        connection, 
        referencePublicKey, 
        { finality: 'confirmed' }
      );

      // Validate the transfer
      const validateParams = {
        recipient: MERCHANT_WALLET,
        amount: new BigNumber(payment.amount),
        reference: referencePublicKey
      };

      // Add SPL token if payment uses one
      if (payment.spl_token_mint) {
        validateParams.splToken = new PublicKey(payment.spl_token_mint);
      }

      await validateTransfer(
        connection,
        signatureInfo.signature,
        validateParams,
        { commitment: 'confirmed' }
      );

      // Payment confirmed - update status
      await this.confirmPayment(payment, signatureInfo.signature);

    } catch (error) {
      // Check if it's a FindReferenceError (payment not found yet)
      if (error instanceof FindReferenceError || error.message === 'not found') {
        // This is normal - payment not confirmed yet
        return;
      }
      
      // Log other errors
      logger.warn('Payment validation error:', { 
        reference: payment.reference, 
        error: error.message 
      });
    }
  }

  /**
   * Confirm payment and send notifications
   */
  async confirmPayment(payment, signature) {
    try {
      // Update payment status
      const updatedPayment = await database.updatePaymentStatus(
        payment.reference, 
        'confirmed', 
        signature
      );

      // Send webhook notification
      await sendWebhook('payment.confirmed', {
        reference: payment.reference,
        amount: payment.amount,
        currency: payment.currency,
        signature,
        timestamp: new Date().toISOString()
      });

      // Send real-time WebSocket update
      notifyPaymentUpdate(payment.reference, 'confirmed', {
        amount: payment.amount,
        currency: payment.currency,
        signature
      });

      // Create transaction record
      await database.getClient()
        .from('transactions')
        .insert({
          payment_id: payment.id,
          chain: payment.chain,
          transaction_hash: signature,
          status: 'confirmed',
          confirmed_at: new Date().toISOString()
        });

      // Send confirmation email
      if (payment.customer_email) {
        try {
          await emailService.sendPaymentConfirmedEmail(updatedPayment, payment.customer_email);
        } catch (emailError) {
          logger.warn('Failed to send confirmation email:', emailError);
        }
      }

      logger.info('Payment automatically confirmed:', { 
        reference: payment.reference, 
        signature 
      });

    } catch (error) {
      logger.error('Error confirming payment:', error);
    }
  }
}

module.exports = new PaymentMonitor();
