const database = require('./database');
const logger = require('../utils/logger');

// Initialize Resend only if API key is available
let resend = null;
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@afripay.com';

if (process.env.RESEND_API_KEY) {
  const { Resend } = require('resend');
  resend = new Resend(process.env.RESEND_API_KEY);
  logger.info('Resend email service initialized');
} else {
  logger.warn('RESEND_API_KEY not found - email service will queue only');
}

class EmailService {
  /**
   * Queue an email notification
   */
  async queueEmail(web3AuthUserId, email, type, subject, body) {
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

      logger.info('Email queued:', { id: data.id, type, email });
      return data;
    } catch (error) {
      logger.error('Failed to queue email:', error);
      throw error;
    }
  }

  /**
   * Send email using Resend
   */
  async sendEmail(to, subject, body, type = 'text') {
    try {
      if (!resend) {
        logger.warn('Resend not configured, skipping email send');
        return { success: false, error: 'Email service not configured' };
      }

      const emailData = {
        from: FROM_EMAIL,
        to: [to],
        subject,
        [type === 'html' ? 'html' : 'text']: body,
      };

      const { data, error } = await resend.emails.send(emailData);

      if (error) {
        logger.error('Resend email error:', error);
        return { success: false, error: error.message };
      }

      logger.info('Email sent successfully:', { id: data.id, to, subject });
      return { success: true, id: data.id };
    } catch (error) {
      logger.error('Failed to send email:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send payment created email
   */
  async sendPaymentCreatedEmail(paymentData, customerEmail) {
    const subject = `Payment Request - ${paymentData.amount} ${paymentData.currency}`;
    const body = `
      You have received a payment request.
      
      Amount: ${paymentData.amount} ${paymentData.currency}
      Label: ${paymentData.label}
      ${paymentData.message ? `Message: ${paymentData.message}` : ''}
      
      Pay here: ${paymentData.paymentUrl}
      
      Reference: ${paymentData.reference}
    `;

    return this.queueEmail(paymentData.web3auth_user_id, customerEmail, 'payment_request', subject, body);
  }

  /**
   * Send payment confirmation email
   */
  async sendPaymentConfirmation(web3AuthUserId, email, paymentData) {
    const subject = `Payment Confirmed - ${paymentData.amount} ${paymentData.currency}`;
    const body = `
      Your payment has been confirmed!
      
      Amount: ${paymentData.amount} ${paymentData.currency}
      Reference: ${paymentData.reference}
      Label: ${paymentData.label}
      
      Thank you for your payment!
    `;

    return this.queueEmail(web3AuthUserId, email, 'payment_confirmation', subject, body);
  }

  /**
   * Send subscription renewal reminder
   */
  async sendSubscriptionReminder(web3AuthUserId, email, subscriptionData) {
    const subject = `Subscription Renewal Reminder - ${subscriptionData.planName}`;
    const body = `
      Your subscription "${subscriptionData.planName}" will renew soon.
      
      Amount: ${subscriptionData.amount} ${subscriptionData.currency}
      Next Payment: ${subscriptionData.nextPaymentDate}
      
      Manage your subscription in your dashboard.
    `;

    return this.queueEmail(web3AuthUserId, email, 'subscription_reminder', subject, body);
  }

  /**
   * Process pending emails using Resend
   */
  async processPendingEmails() {
    try {
      const { data: pendingEmails } = await database.getClient()
        .from('email_notifications')
        .select('*')
        .eq('status', 'pending')
        .limit(10);

      let processedCount = 0;

      for (const email of pendingEmails || []) {
        try {
          // Send email using Resend
          const result = await this.sendEmail(email.email, email.subject, email.body);

          if (result.success) {
            // Mark as sent
            await database.getClient()
              .from('email_notifications')
              .update({
                status: 'sent',
                sent_at: new Date().toISOString()
              })
              .eq('id', email.id);

            processedCount++;
            logger.info('Email sent:', { id: email.id, type: email.type, to: email.email });
          } else {
            // Mark as failed
            await database.getClient()
              .from('email_notifications')
              .update({
                status: 'failed',
                error_message: result.error
              })
              .eq('id', email.id);

            logger.error('Email send failed:', { id: email.id, error: result.error });
          }
        } catch (error) {
          // Mark as failed
          await database.getClient()
            .from('email_notifications')
            .update({
              status: 'failed',
              error_message: error.message
            })
            .eq('id', email.id);

          logger.error('Email processing failed:', { id: email.id, error: error.message });
        }
      }

      if (processedCount > 0) {
        logger.info(`Email processing completed: ${processedCount}/${pendingEmails?.length || 0} emails sent`);
      }

      return processedCount;
    } catch (error) {
      logger.error('Failed to process pending emails:', error);
      throw error;
    }
  }
}

module.exports = new EmailService();
