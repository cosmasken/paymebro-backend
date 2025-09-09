const { findReference, validateTransfer, FindReferenceError } = require('@solana/pay');
const { MERCHANT_WALLET, establishConnection } = require('./solana');
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
      const { data: pendingPayments, error } = await database.getClient()
        .from('payments')
        .select('id, reference, amount, currency, spl_token_mint, web3auth_user_id, customer_email, chain, recipient_address')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(50);

      if (error) {
        logger.error('Database error retrieving pending payments:', {
          error: error.message,
          code: error.code,
          details: error.details
        });
        return;
      }

      if (!pendingPayments || pendingPayments.length === 0) return;

      logger.info('Processing pending payments:', { count: pendingPayments.length });

      for (const payment of pendingPayments) {
        await this.checkPaymentConfirmation(payment);
      }
    } catch (error) {
      logger.error('Error checking pending payments:', {
        error: error.message,
        stack: error.stack
      });
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
        recipient: new PublicKey(payment.recipient_address || MERCHANT_WALLET.toString()),
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
      
      // Log validation errors but don't spam
      logger.warn('Payment validation error:', { 
        reference: payment.reference, 
        error: error.message
      });
    }
  }

  /**
   * Update payment analytics (consolidated from analyticsUpdater.js)
   */
  async updatePaymentAnalytics(paymentId) {
    try {
      const { data: analytics } = await database.getClient()
        .from('payment_analytics')
        .select('*')
        .eq('payment_id', paymentId)
        .single();

      if (analytics) {
        // Update existing analytics
        await database.getClient()
          .from('payment_analytics')
          .update({
            updated_at: new Date().toISOString()
          })
          .eq('payment_id', paymentId);
      } else {
        // Create new analytics record
        await database.getClient()
          .from('payment_analytics')
          .insert({
            payment_id: paymentId,
            total_visits: 0,
            total_scans: 0,
            unique_visitors: 0,
            conversion_rate: 0
          });
      }

      logger.info('Payment analytics updated:', { paymentId });
    } catch (error) {
      logger.error('Payment analytics update failed:', { paymentId, error: error.message });
    }
  }

  /**
   * Confirm payment and send notifications
   */
  async confirmPayment(payment, signature) {
    try {
      // Update payment status with error handling
      let updatedPayment;
      try {
        updatedPayment = await database.updatePaymentStatus(
          payment.reference, 
          'confirmed', 
          signature
        );
      } catch (dbError) {
        logger.error('Database error updating payment status in monitor:', {
          reference: payment.reference,
          status: 'confirmed',
          error: dbError.message,
          code: dbError.code
        });
        return;
      }

      // Send webhook notification
      try {
        await sendWebhook('payment.confirmed', {
          reference: payment.reference,
          amount: payment.amount,
          currency: payment.currency,
          signature,
          timestamp: new Date().toISOString()
        });
      } catch (webhookError) {
        logger.warn('Failed to send webhook notification:', {
          reference: payment.reference,
          error: webhookError.message
        });
      }

      // Send real-time WebSocket update
      const wsResult = notifyPaymentUpdate(payment.reference, 'confirmed', {
        amount: payment.amount,
        currency: payment.currency,
        signature
      });
      
      if (!wsResult.success) {
        logger.warn('Failed to send WebSocket notification:', {
          reference: payment.reference,
          error: wsResult.error
        });
      }

      // Create transaction record
      try {
        await database.getClient()
          .from('transactions')
          .insert({
            payment_id: payment.id,
            chain: payment.chain,
            transaction_hash: signature,
            status: 'confirmed',
            confirmed_at: new Date().toISOString()
          });
      } catch (txError) {
        logger.warn('Failed to create transaction record:', {
          reference: payment.reference,
          error: txError.message
        });
      }

      // Send confirmation email
      if (payment.customer_email) {
        try {
          await emailService.sendPaymentConfirmedEmail(updatedPayment, payment.customer_email);
        } catch (emailError) {
          logger.warn('Failed to send confirmation email:', {
            reference: payment.reference,
            email: payment.customer_email,
            error: emailError.message
          });
        }
      }

      logger.info('Payment automatically confirmed:', { 
        reference: payment.reference, 
        signature 
      });

    } catch (error) {
      logger.error('Error confirming payment:', {
        reference: payment.reference,
        error: error.message,
        stack: error.stack
      });
    }
  }
}

module.exports = new PaymentMonitor();
