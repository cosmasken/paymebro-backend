const database = require('../services/database');
const SubscriptionService = require('../services/subscriptions');
const logger = require('../utils/logger');
const { asyncHandler } = require('../middleware/errorHandler');

class SubscriptionController {
  /**
   * Create subscription plan
   */
  static createPlan = asyncHandler(async (req, res) => {
    const { web3auth_user_id } = req.user;
    const { name, description, amount, currency, intervalType, intervalCount, trialDays, maxSubscribers } = req.body;

    const { data: plan } = await database.getClient()
      .from('subscription_plans')
      .insert({
        web3auth_user_id,
        name,
        description,
        amount,
        currency: currency || 'SOL',
        interval_type: intervalType,
        interval_count: intervalCount || 1,
        trial_days: trialDays || 0,
        max_subscribers: maxSubscribers
      })
      .select()
      .single();

    res.json({ success: true, plan });
  });

  /**
   * Subscribe customer to plan
   */
  static subscribe = asyncHandler(async (req, res) => {
    const { planId, customerEmail, customerWallet } = req.body;

    const { data: plan } = await database.getClient()
      .from('subscription_plans')
      .select('*')
      .eq('id', planId)
      .single();

    if (!plan) {
      return res.status(404).json({ success: false, error: 'Plan not found' });
    }

    const now = new Date();
    const trialEnd = plan.trial_days > 0 ? 
      new Date(now.getTime() + plan.trial_days * 24 * 60 * 60 * 1000) : null;
    
    const { data: nextPaymentDate } = await database.getClient()
      .rpc('calculate_next_payment_date', {
        current_date: trialEnd || now,
        interval_type: plan.interval_type,
        interval_count: plan.interval_count
      });

    const { data: subscription } = await database.getClient()
      .from('subscriptions')
      .insert({
        plan_id: planId,
        customer_email: customerEmail,
        customer_wallet: customerWallet,
        status: plan.trial_days > 0 ? 'trial' : 'active',
        trial_end: trialEnd,
        next_payment_date: nextPaymentDate,
        current_period_end: nextPaymentDate
      })
      .select()
      .single();

    // Send welcome email and webhook
    await SubscriptionService.sendSubscriptionEmail('created', subscription, { plan });
    await SubscriptionService.sendSubscriptionWebhook('subscription.created', subscription, { plan });

    res.json({ success: true, subscription });
  });

  /**
   * Cancel subscription
   */
  static cancelSubscription = asyncHandler(async (req, res) => {
    const { subscriptionId } = req.params;
    const { reason } = req.body;

    const { data: subscription } = await database.getClient()
      .from('subscriptions')
      .update({ status: 'cancelled' })
      .eq('id', subscriptionId)
      .select(`*, subscription_plans(*)`)
      .single();

    // Send cancellation email and webhook
    await SubscriptionService.sendSubscriptionEmail('cancelled', subscription, { plan: subscription.subscription_plans });
    await SubscriptionService.sendSubscriptionWebhook('subscription.cancelled', subscription, { reason: reason || 'user_requested' });

    res.json({ success: true, subscription });
  });

  /**
   * Get subscription analytics
   */
  static getAnalytics = asyncHandler(async (req, res) => {
    const { web3auth_user_id } = req.user;

    const metrics = await SubscriptionService.updateAnalytics(web3auth_user_id);
    
    res.json({ success: true, metrics });
  });

  /**
   * Get merchant's plans
   */
  static getPlans = asyncHandler(async (req, res) => {
    const { web3auth_user_id } = req.user;

    const { data: plans } = await database.getClient()
      .from('subscription_plans')
      .select(`*, subscriptions(count)`)
      .eq('web3auth_user_id', web3auth_user_id)
      .order('created_at', { ascending: false });

    res.json({ success: true, plans });
  });
}

module.exports = SubscriptionController;
