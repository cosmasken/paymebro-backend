const express = require('express');
const router = express.Router();
const PaymentController = require('../controllers/payments');
const { validatePaymentRequest, validatePaymentConfirmation } = require('../middleware/validation');

/**
 * Payment creation and QR generation
 */
router.post('/create', validatePaymentRequest, PaymentController.createPayment);

/**
 * Get payment details by reference
 */
router.get('/:reference', PaymentController.getPayment);

/**
 * Confirm payment transaction
 */
router.post('/confirm', validatePaymentConfirmation, PaymentController.confirmPayment);

/**
 * Manual confirm payment (for testing)
 */
router.post('/:reference/confirm', PaymentController.manualConfirmPayment);

/**
 * Get payment status
 */
router.get('/:reference/status', PaymentController.getPaymentStatus);

/**
 * Send payment invoice via email
 */
router.post('/:reference/invoice', PaymentController.sendInvoice);

module.exports = router;
