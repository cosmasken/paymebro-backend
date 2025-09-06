const logger = require('../utils/logger');
const { asyncHandler } = require('../middleware/errorHandler');

// Simple in-memory webhook storage for demo
const webhooks = [];

/**
 * Register webhook endpoint
 */
const registerWebhook = asyncHandler(async (req, res) => {
  const { url, events = ['payment.confirmed'] } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const webhook = { id: Date.now(), url, events };
  webhooks.push(webhook);
  
  logger.info('Webhook registered:', webhook);
  res.json({ success: true, webhook });
});

/**
 * Send webhook notification
 */
const sendWebhook = async (event, data) => {
  const relevantWebhooks = webhooks.filter(w => w.events.includes(event));
  
  for (const webhook of relevantWebhooks) {
    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, data, timestamp: new Date().toISOString() })
      });
      
      logger.info('Webhook sent:', { url: webhook.url, event, status: response.status });
    } catch (error) {
      logger.error('Webhook failed:', { url: webhook.url, error: error.message });
    }
  }
};

module.exports = { registerWebhook, sendWebhook };
