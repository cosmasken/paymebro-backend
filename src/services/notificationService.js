const database = require('./database');
const logger = require('../utils/logger');

// Initialize Resend only if API key is available
let resend = null;
const FROM_EMAIL = process.env.FROM_EMAIL || 'payments@paymebro.xyz'

if (process.env.RESEND_API_KEY) {
  const { Resend } = require('resend');
  resend = new Resend(process.env.RESEND_API_KEY);
  logger.info('Resend notification service initialized');
} else {
  logger.warn('RESEND_API_KEY not found - notifications will queue only');
}

class NotificationService {
  /**
   * Send payment invoice
   */
  async sendInvoice(paymentData, customerEmail) {
    const subject = `Invoice for ${paymentData.label}`;
    const body = `
      <h2>Payment Invoice</h2>
      <p>Amount: ${paymentData.amount} ${paymentData.currency}</p>
      <p>Description: ${paymentData.label}</p>
      <p>Payment Link: ${paymentData.paymentUrl}</p>
      <p>Reference: ${paymentData.reference}</p>
    `;

    return this.queueNotification(
      paymentData.web3AuthUserId,
      customerEmail,
      'invoice',
      subject,
      body
    );
  }

  /**
   * Send payment confirmation notification
   */
  async sendPaymentConfirmation(paymentData, customerEmail) {
    const subject = `Payment Confirmed - ${paymentData.label}`;
    const body = `
      <h2>Payment Confirmed</h2>
      <p>Your payment of ${paymentData.amount} ${paymentData.currency} has been confirmed.</p>
      <p>Transaction: ${paymentData.signature}</p>
      <p>Reference: ${paymentData.reference}</p>
    `;

    return this.queueNotification(
      paymentData.web3AuthUserId,
      customerEmail,
      'confirmation',
      subject,
      body
    );
  }

  /**
   * Send payment reminder
   */
  async sendPaymentReminder(paymentData, customerEmail) {
    const subject = `Payment Reminder - ${paymentData.label}`;
    const body = `
      <h2>Payment Reminder</h2>
      <p>You have a pending payment of ${paymentData.amount} ${paymentData.currency}</p>
      <p>Payment Link: ${paymentData.paymentUrl}</p>
      <p>Reference: ${paymentData.reference}</p>
    `;

    return this.queueNotification(
      paymentData.web3AuthUserId,
      customerEmail,
      'reminder',
      subject,
      body
    );
  }

  /**
   * Queue a notification
   */
  async queueNotification(web3AuthUserId, email, type, subject, body) {
    try {
      const { data, error } = await database.getClient()
        .from('email_notifications')
        .insert({
          web3auth_user_id: web3AuthUserId,
          email,
          type,
          subject,
          body,
          status: 'pending'
        })
        .select()
        .single();

      if (error) throw error;

      logger.info('Notification queued:', { id: data.id, type, email });
      return data;
    } catch (error) {
      logger.error('Failed to queue notification:', error);
      throw error;
    }
  }

  /**
   * Send notification using Resend
   */
  async sendNotification(to, subject, body) {
    try {
      if (!resend) {
        logger.warn('Resend not configured - notification not sent');
        return { success: false, error: 'Email service not configured' };
      }

      const result = await resend.emails.send({
        from: FROM_EMAIL,
        to,
        subject,
        html: body
      });

      logger.info('Notification sent:', { to, subject, id: result.data?.id });
      return { success: true, id: result.data?.id };
    } catch (error) {
      logger.error('Failed to send notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Process pending notifications
   */
  async processPendingNotifications() {
    try {
      const { data: notifications } = await database.getClient()
        .from('email_notifications')
        .select('*')
        .eq('status', 'pending')
        .limit(10);

      for (const notification of notifications || []) {
        const result = await this.sendNotification(
          notification.email,
          notification.subject,
          notification.body
        );

        await database.getClient()
          .from('email_notifications')
          .update({
            status: result.success ? 'sent' : 'failed',
            sent_at: result.success ? new Date().toISOString() : null,
            error_message: result.error || null
          })
          .eq('id', notification.id);
      }

      logger.info(`Processed ${notifications?.length || 0} notifications`);
    } catch (error) {
      logger.error('Failed to process notifications:', error);
    }
  }
}

module.exports = new NotificationService();
