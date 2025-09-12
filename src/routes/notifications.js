const express = require('express');
const router = express.Router();
const notificationService = require('../services/notificationService');
const database = require('../services/database');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * GET /api/notifications/user/:userId
 * Get user's notifications
 */
router.get('/user/:userId', asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const { data: notifications } = await database.getClient()
    .from('email_notifications')
    .select('*')
    .eq('web3auth_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  res.json({ success: true, notifications: notifications || [] });
}));

/**
 * POST /api/notifications/process
 * Process pending notifications
 */
router.post('/process', asyncHandler(async (req, res) => {
  await notificationService.processPendingNotifications();
  res.json({ success: true, message: 'Notifications processed' });
}));

/**
 * POST /api/notifications/send-reminder
 * Send payment reminder
 */
router.post('/send-reminder', asyncHandler(async (req, res) => {
  const { paymentReference, customerEmail } = req.body;

  // Get payment details
  const { data: payment } = await database.getClient()
    .from('payments')
    .select('*')
    .eq('reference', paymentReference)
    .single();

  if (!payment) {
    return res.status(404).json({ success: false, error: 'Payment not found' });
  }

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  await notificationService.sendPaymentReminder({
    ...payment,
    paymentUrl: `${baseUrl}/payment/${paymentReference}`
  }, customerEmail);

  res.json({ success: true, message: 'Reminder sent' });
}));

module.exports = router;
