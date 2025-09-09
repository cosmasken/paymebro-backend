const express = require('express');
const router = express.Router();
const SubscriptionController = require('../controllers/subscriptions');
const SubscriptionService = require('../services/subscriptions');
const { authenticateUser } = require('../middleware/auth');

/**
 * Create subscription plan
 */
router.post('/plans', authenticateUser, SubscriptionController.createPlan);

/**
 * Get merchant's plans
 */
router.get('/plans', authenticateUser, SubscriptionController.getPlans);

/**
 * Subscribe to plan
 */
router.post('/subscribe', SubscriptionController.subscribe);

/**
 * Get subscription analytics
 */
router.get('/analytics', authenticateUser, SubscriptionController.getAnalytics);

/**
 * Cancel subscription
 */
router.delete('/:subscriptionId', SubscriptionController.cancelSubscription);

/**
 * Cron job endpoints
 */
router.post('/cron/daily', async (req, res) => {
  await SubscriptionService.processRenewals();
  res.json({ success: true, message: 'Daily cron completed' });
});

module.exports = router;
