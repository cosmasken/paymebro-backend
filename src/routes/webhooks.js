const express = require('express');
const router = express.Router();
const { registerWebhook } = require('../controllers/webhooks');

/**
 * POST /api/webhooks
 * Register a webhook endpoint
 */
router.post('/', registerWebhook);

module.exports = router;
