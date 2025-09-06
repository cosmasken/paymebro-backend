const database = require('../services/database');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * Get payment analytics and metrics
 */
const getMetrics = asyncHandler(async (req, res) => {
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
      conversionRate: totalPayments > 0 ? (confirmedPayments / totalPayments * 100).toFixed(2) : 0
    }
  });
});

/**
 * Get payment history with pagination
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

module.exports = {
  getMetrics,
  getPaymentHistory
};
