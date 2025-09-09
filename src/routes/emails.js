const express = require('express');
const router = express.Router();
const emailService = require('../services/emailService');
const { processEmails } = require('../jobs/emailProcessor');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * GET /api/emails/pending
 * Get pending email notifications
 */
router.get('/pending', asyncHandler(async (req, res) => {
  const userId = req.headers['x-user-id'];
  
  if (!userId) {
    return res.status(400).json({
      success: false,
      error: 'User ID required'
    });
  }

  const { data: emails } = await require('../services/database').getClient()
    .from('email_notifications')
    .select('*')
    .eq('web3auth_user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  res.json({
    success: true,
    emails: emails || []
  });
}));

/**
 * POST /api/emails/process
 * Manually trigger email processing
 */
router.post('/process', asyncHandler(async (req, res) => {
  const processedCount = await processEmails();
  
  res.json({
    success: true,
    message: `Processed ${processedCount} emails`,
    count: processedCount
  });
}));

/**
 * POST /api/emails/test
 * Send test email
 */
router.post('/test', asyncHandler(async (req, res) => {
  const { email, userId } = req.body;
  
  if (!email || !userId) {
    return res.status(400).json({
      success: false,
      error: 'Email and userId required'
    });
  }

  await emailService.queueEmail(
    userId,
    email,
    'test',
    'Test Email from AfriPay',
    'This is a test email to verify the email system is working correctly.'
  );

  res.json({
    success: true,
    message: 'Test email queued successfully'
  });
}));

module.exports = router;
