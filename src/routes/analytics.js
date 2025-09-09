const express = require('express');
const router = express.Router();
const { 
  getMetrics, 
  getPaymentHistory, 
  getMerchantAnalytics, 
  getPaymentAnalytics, 
  getAnalyticsTrends 
} = require('../controllers/analytics');
const { authenticateUser } = require('../middleware/auth');

/**
 * GET /api/analytics - Get basic payment metrics
 */
router.get('/', getMetrics);

/**
 * GET /api/analytics/history - Get payment history with pagination
 */
router.get('/history', getPaymentHistory);

/**
 * GET /api/analytics/overview - Get detailed merchant analytics
 */
router.get('/overview', authenticateUser, getMerchantAnalytics);

/**
 * GET /api/analytics/payment/:reference - Get analytics for specific payment
 */
router.get('/payment/:reference', authenticateUser, getPaymentAnalytics);

/**
 * GET /api/analytics/trends - Get analytics trends over time
 */
router.get('/trends', authenticateUser, getAnalyticsTrends);

module.exports = router;
