const express = require('express');
const router = express.Router();
const { getMetrics, getPaymentHistory } = require('../controllers/metrics');

/**
 * GET /api/metrics
 * Get payment analytics
 */
router.get('/', getMetrics);

/**
 * GET /api/metrics/history
 * Get payment history with pagination
 */
router.get('/history', getPaymentHistory);

module.exports = router;
