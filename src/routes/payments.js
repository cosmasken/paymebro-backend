const express = require('express');
const router = express.Router();
const { 
  createPayment, 
  getPayment, 
  getPaymentStatus, 
  generatePaymentQR, 
  sendInvoice, 
  confirmPayment, 
  manualConfirmPayment,
  getTransactionRequest,
  createTransaction
} = require('../controllers/payments');
const { validatePaymentRequest, validatePaymentConfirmation } = require('../middleware/validation');
const { paymentCreationLimiter, paymentConfirmationLimiter } = require('../middleware/rateLimiting');
const { trackLinkVisit, trackQRScan } = require('../middleware/analytics');

/**
 * Create new payment
 */
router.post('/create', paymentCreationLimiter, validatePaymentRequest, createPayment);

/**
 * Get payment details by reference
 */
router.get('/:reference', trackLinkVisit, getPayment);

/**
 * Get payment status
 */
router.get('/:reference/status', getPaymentStatus);

/**
 * Generate QR code for payment
 */
router.get('/:reference/qr', trackQRScan, generatePaymentQR);

/**
 * Send payment invoice via email
 */
router.post('/:reference/invoice', sendInvoice);

/**
 * Transaction request endpoints (consolidated from separate route file)
 */
router.get('/:reference/transaction-request', getTransactionRequest);
router.post('/:reference/transaction-request', createTransaction);

/**
 * Confirm payment transaction
 */
router.post('/confirm', paymentConfirmationLimiter, validatePaymentConfirmation, confirmPayment);

/**
 * Manual confirm payment (for testing)
 */
router.post('/:reference/confirm', paymentConfirmationLimiter, manualConfirmPayment);

module.exports = router;
