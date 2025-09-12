const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const database = require('../services/database');
const userService = require('../services/userService');
const logger = require('../utils/logger');

/**
 * GET /api/plans/usage
 * Get user's current plan usage
 */
router.get('/usage', asyncHandler(async (req, res) => {
  const userId = req.headers['x-user-id'];

  if (!userId) {
    return res.status(400).json({
      success: false,
      error: 'User ID required'
    });
  }

  try {
    const userStats = await userService.getUserStats(userId);

    res.json({
      success: true,
      usage: {
        currentPlan: userStats.plan,
        monthlyUsage: userStats.monthlyPayments,
        monthlyLimit: userStats.monthlyLimit === Infinity ? 'unlimited' : userStats.monthlyLimit,
        percentage: userStats.monthlyLimit === Infinity ? 0 : Math.min((userStats.monthlyPayments / userStats.monthlyLimit) * 100, 100),
        canCreatePayment: userStats.canCreatePayment,
        remaining: userStats.remainingPayments === Infinity ? 'unlimited' : userStats.remainingPayments
      }
    });

  } catch (error) {
    logger.error('Plan usage fetch failed', {
      error: error.message,
      userId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to fetch plan usage'
    });
  }
}));

/**
 * POST /api/plans/upgrade
 * Upgrade user plan
 */
router.post('/upgrade', asyncHandler(async (req, res) => {
  const userId = req.headers['x-user-id'];
  const { planType } = req.body;

  if (!userId) {
    return res.status(400).json({
      success: false,
      error: 'User ID required'
    });
  }

  if (!['free', 'pro', 'enterprise'].includes(planType)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid plan type'
    });
  }

  const client = await database.getClient().connect();

  try {
    await client.query(
      'UPDATE users SET plan_type = $1, updated_at = CURRENT_TIMESTAMP WHERE web3auth_user_id = $2',
      [planType, userId]
    );

    logger.info('User plan upgraded', {
      userId,
      newPlan: planType
    });

    res.json({
      success: true,
      message: `Plan upgraded to ${planType}`,
      planType
    });

  } catch (error) {
    logger.error('Plan upgrade failed', {
      error: error.message,
      userId,
      planType
    });

    res.status(500).json({
      success: false,
      error: 'Failed to upgrade plan'
    });
  } finally {
    client.release();
  }
}));

/**
 * GET /api/plans/info
 * Get available plans information
 */
router.get('/info', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    plans: {
      free: {
        name: 'Free',
        monthlyLimit: 100,
        price: 0,
        features: ['100 payments/month', 'Basic analytics', 'Email support']
      },
      pro: {
        name: 'Pro',
        monthlyLimit: 1000,
        price: 29,
        features: ['1,000 payments/month', 'Advanced analytics', 'Priority support', 'Custom webhooks']
      },
      enterprise: {
        name: 'Enterprise',
        monthlyLimit: 'unlimited',
        price: 'custom',
        features: ['Unlimited payments', 'Custom integrations', 'Dedicated support', 'SLA guarantee']
      }
    }
  });
}));

module.exports = router;
