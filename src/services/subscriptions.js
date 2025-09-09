const database = require('./database');
const emailService = require('./emailService');
const { sendWebhook } = require('../controllers/webhooks');
const logger = require('../utils/logger');

/**
 * Consolidated subscription service handling analytics, emails, webhooks, and cron jobs
 */
class SubscriptionService {
  
  /**
   * Update subscription analytics (from subscriptionAnalytics.js)
   */
  static async updateAnalytics(subscriptionId) {
    try {
      const { data: subscription } = await database.getClient()
        .from('subscriptions')
        .select('*, subscription_plans(*)')
        .eq('id', subscriptionId)
        .single();

      if (!subscription) return;

      // Calculate MRR, LTV, churn rate
      const { data: allSubscriptions } = await database.getClient()
        .from('subscriptions')
        .select('*')
        .eq('plan_id', subscription.plan_id);

      const activeCount = allSubscriptions?.filter(s => s.status === 'active').length || 0;
      const mrr = activeCount * parseFloat(subscription.subscription_plans.amount);
      
      logger.info('Subscription analytics updated:', { subscriptionId, mrr, activeCount });
    } catch (error) {
      logger.error('Subscription analytics update failed:', error);
    }
  }

  /**
   * Send subscription emails (from subscriptionEmails.js)
   */
  static async sendSubscriptionEmail(type, subscription, additionalData = {}) {
    try {
      const emailTemplates = {
        created: {
          subject: 'Subscription Confirmed',
          template: 'subscription-created'
        },
        payment_succeeded: {
          subject: 'Payment Successful',
          template: 'subscription-payment-success'
        },
        payment_failed: {
          subject: 'Payment Failed',
          template: 'subscription-payment-failed'
        },
        cancelled: {
          subject: 'Subscription Cancelled',
          template: 'subscription-cancelled'
        }
      };

      const emailConfig = emailTemplates[type];
      if (!emailConfig || !subscription.customer_email) return;

      await emailService.sendEmail({
        to: subscription.customer_email,
        subject: emailConfig.subject,
        template: emailConfig.template,
        data: { subscription, ...additionalData }
      });

      logger.info('Subscription email sent:', { type, subscriptionId: subscription.id });
    } catch (error) {
      logger.error('Subscription email failed:', error);
    }
  }

  /**
   * Send subscription webhooks (from subscriptionWebhooks.js)
   */
  static async sendSubscriptionWebhook(event, subscription, additionalData = {}) {
    try {
      const webhookData = {
        event,
        subscription_id: subscription.id,
        plan_id: subscription.plan_id,
        customer_email: subscription.customer_email,
        status: subscription.status,
        timestamp: new Date().toISOString(),
        ...additionalData
      };

      await sendWebhook('subscription', webhookData);
      logger.info('Subscription webhook sent:', { event, subscriptionId: subscription.id });
    } catch (error) {
      logger.error('Subscription webhook failed:', error);
    }
  }

  /**
   * Process subscription renewals (from subscriptionCron.js)
   */
  static async processRenewals() {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const { data: dueSubscriptions } = await database.getClient()
        .from('subscriptions')
        .select('*, subscription_plans(*)')
        .eq('status', 'active')
        .lte('next_billing_date', today);

      for (const subscription of dueSubscriptions || []) {
        await this.processRenewal(subscription);
      }

      logger.info('Subscription renewals processed:', { count: dueSubscriptions?.length || 0 });
    } catch (error) {
      logger.error('Subscription renewal processing failed:', error);
    }
  }

  /**
   * Process individual subscription renewal
   */
  static async processRenewal(subscription) {
    try {
      // Calculate next billing date
      const nextDate = new Date(subscription.next_billing_date);
      const plan = subscription.subscription_plans;
      
      if (plan.interval_type === 'monthly') {
        nextDate.setMonth(nextDate.getMonth() + plan.interval_count);
      } else if (plan.interval_type === 'yearly') {
        nextDate.setFullYear(nextDate.getFullYear() + plan.interval_count);
      }

      // Update subscription
      await database.getClient()
        .from('subscriptions')
        .update({
          next_billing_date: nextDate.toISOString().split('T')[0],
          updated_at: new Date().toISOString()
        })
        .eq('id', subscription.id);

      // Send notifications
      await this.sendSubscriptionEmail('payment_succeeded', subscription);
      await this.sendSubscriptionWebhook('subscription.payment_succeeded', subscription);
      await this.updateAnalytics(subscription.id);

      logger.info('Subscription renewed:', { subscriptionId: subscription.id });
    } catch (error) {
      logger.error('Subscription renewal failed:', { subscriptionId: subscription.id, error });
      
      // Handle failed renewal
      await this.sendSubscriptionEmail('payment_failed', subscription);
      await this.sendSubscriptionWebhook('subscription.payment_failed', subscription);
    }
  }

  /**
   * Cancel subscription
   */
  static async cancelSubscription(subscriptionId, reason = 'user_requested') {
    try {
      const { data: subscription } = await database.getClient()
        .from('subscriptions')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancellation_reason: reason
        })
        .eq('id', subscriptionId)
        .select()
        .single();

      if (subscription) {
        await this.sendSubscriptionEmail('cancelled', subscription);
        await this.sendSubscriptionWebhook('subscription.cancelled', subscription, { reason });
        await this.updateAnalytics(subscriptionId);
      }

      logger.info('Subscription cancelled:', { subscriptionId, reason });
    } catch (error) {
      logger.error('Subscription cancellation failed:', error);
    }
  }
}

module.exports = SubscriptionService;
