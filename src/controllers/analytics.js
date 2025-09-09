const database = require('../services/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const DeterministicAddressService = require('../services/deterministicAddressService');

const deterministicService = new DeterministicAddressService();

/**
 * Get basic payment metrics with user tracking
 */
const getMetrics = asyncHandler(async (req, res) => {
  const userId = req.headers['x-user-id'];
  
  const { data: payments } = await database.getClient()
    .from('payments')
    .select('*');

  const { data: users } = await database.getClient()
    .from('users')
    .select('*');

  // Calculate metrics
  const totalPayments = payments?.length || 0;
  const confirmedPayments = payments?.filter(p => p.status === 'confirmed').length || 0;
  const pendingPayments = payments?.filter(p => p.status === 'pending').length || 0;
  const totalUsers = users?.length || 0;

  // Revenue metrics
  const totalRevenue = payments
    ?.filter(p => p.status === 'confirmed')
    .reduce((sum, p) => sum + parseFloat(p.amount || 0), 0) || 0;

  // User-specific metrics if userId provided
  let userMetrics = {};
  if (userId) {
    try {
      const userTracking = await deterministicService.getUserPaymentTracking(userId);
      const userPayments = payments?.filter(p => p.web3auth_user_id === userId) || [];
      const userPlan = await deterministicService.getUserPlan(userId);
      const monthlyCount = await deterministicService.getMonthlyPaymentCount(userId);
      
      // Plan limits
      const planLimits = {
        free: 100,
        pro: 1000,
        enterprise: Infinity
      };
      
      const monthlyLimit = planLimits[userPlan] || planLimits.free;
      
      userMetrics = {
        totalPayments: userTracking ? userTracking.total_payments : 0,
        paymentCounter: userTracking ? userTracking.payment_counter : 0,
        confirmedPayments: userPayments.filter(p => p.status === 'confirmed').length,
        pendingPayments: userPayments.filter(p => p.status === 'pending').length,
        totalRevenue: userPayments
          .filter(p => p.status === 'confirmed')
          .reduce((sum, p) => sum + parseFloat(p.amount || 0), 0),
        planInfo: {
          currentPlan: userPlan,
          monthlyUsage: monthlyCount,
          monthlyLimit: monthlyLimit === Infinity ? 'unlimited' : monthlyLimit,
          percentage: monthlyLimit === Infinity ? 0 : Math.min((monthlyCount / monthlyLimit) * 100, 100)
        }
      };
    } catch (error) {
      logger.error('Failed to fetch user metrics', { userId, error: error.message });
    }
  }

  // Currency breakdown
  const currencyStats = payments?.reduce((acc, p) => {
    acc[p.currency] = (acc[p.currency] || 0) + 1;
    return acc;
  }, {}) || {};

  // Recent payments (last 24h)
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recentPayments = payments?.filter(p => p.created_at > yesterday).length || 0;

  res.json({
    success: true,
    metrics: {
      totalPayments,
      confirmedPayments,
      pendingPayments,
      totalUsers,
      totalRevenue,
      recentPayments,
      currencyStats,
      conversionRate: totalPayments > 0 ? (confirmedPayments / totalPayments * 100).toFixed(2) : "0.00"
    }
  });
});

/**
 * Get payment history with pagination (consolidated from metrics controller)
 */
const getPaymentHistory = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;

  const { data: payments, count } = await database.getClient()
    .from('payments')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  res.json({
    success: true,
    payments: payments || [],
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: count || 0,
      pages: Math.ceil((count || 0) / limit)
    }
  });
});

/**
 * Get detailed merchant analytics
 */
const getMerchantAnalytics = asyncHandler(async (req, res) => {
  const web3AuthUserId = req.headers['x-user-id'];
  
  if (!web3AuthUserId) {
    return res.status(400).json({
      success: false,
      error: 'User ID required'
    });
  }

  try {
    // Get user's payments
    const { data: payments } = await database.getClient()
      .from('payments')
      .select('*')
      .eq('web3auth_user_id', web3AuthUserId);

    // Calculate detailed analytics
    const totalPayments = payments?.length || 0;
    const confirmedPayments = payments?.filter(p => p.status === 'confirmed').length || 0;
    const totalRevenue = payments
      ?.filter(p => p.status === 'confirmed')
      .reduce((sum, p) => sum + parseFloat(p.amount || 0), 0) || 0;

    // Monthly revenue trend
    const monthlyRevenue = {};
    payments?.filter(p => p.status === 'confirmed').forEach(payment => {
      const month = new Date(payment.created_at).toISOString().slice(0, 7);
      monthlyRevenue[month] = (monthlyRevenue[month] || 0) + parseFloat(payment.amount || 0);
    });

    res.json({
      success: true,
      analytics: {
        totalPayments,
        confirmedPayments,
        totalRevenue,
        conversionRate: totalPayments > 0 ? (confirmedPayments / totalPayments * 100).toFixed(2) : "0.00",
        monthlyRevenue
      }
    });

  } catch (error) {
    logger.error('Error fetching merchant analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch analytics'
    });
  }
});

/**
 * Get analytics for specific payment
 */
const getPaymentAnalytics = asyncHandler(async (req, res) => {
  const { reference } = req.params;
  
  try {
    const { data: payment } = await database.getClient()
      .from('payments')
      .select('*')
      .eq('reference', reference)
      .single();

    if (!payment) {
      return res.status(404).json({
        success: false,
        error: 'Payment not found'
      });
    }

    res.json({
      success: true,
      analytics: {
        reference: payment.reference,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        createdAt: payment.created_at,
        confirmedAt: payment.confirmed_at
      }
    });

  } catch (error) {
    logger.error('Error fetching payment analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch payment analytics'
    });
  }
});

/**
 * Get analytics trends over time
 */
const getAnalyticsTrends = asyncHandler(async (req, res) => {
  const web3AuthUserId = req.headers['x-user-id'];
  const { period = '30d' } = req.query;
  
  try {
    let startDate;
    if (period === '7d') {
      startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === '30d') {
      startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    } else {
      startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    }

    const { data: payments } = await database.getClient()
      .from('payments')
      .select('*')
      .eq('web3auth_user_id', web3AuthUserId)
      .gte('created_at', startDate.toISOString());

    // Group by day
    const dailyStats = {};
    payments?.forEach(payment => {
      const day = new Date(payment.created_at).toISOString().slice(0, 10);
      if (!dailyStats[day]) {
        dailyStats[day] = { payments: 0, revenue: 0 };
      }
      dailyStats[day].payments++;
      if (payment.status === 'confirmed') {
        dailyStats[day].revenue += parseFloat(payment.amount || 0);
      }
    });

    res.json({
      success: true,
      trends: dailyStats
    });

  } catch (error) {
    logger.error('Error fetching analytics trends:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch trends'
    });
  }
});

module.exports = {
  getMetrics,
  getPaymentHistory,
  getMerchantAnalytics,
  getPaymentAnalytics,
  getAnalyticsTrends
};
