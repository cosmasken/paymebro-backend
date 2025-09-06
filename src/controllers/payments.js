const { encodeURL, findReference, validateTransfer } = require('@solana/pay');
const { MERCHANT_WALLET } = require('../modules/solana-payment-merchant-flow/constants');
const { establishConnection } = require('../modules/solana-payment-merchant-flow/establishConnection');
const BigNumber = require('bignumber.js');
const { Keypair, PublicKey } = require('@solana/web3.js');
const emailService = require('../services/emailService');
const database = require('../services/database');
const logger = require('../utils/logger');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * Create a new payment request
 */
const createPayment = asyncHandler(async (req, res) => {
  const { amount, label, message, memo, customerEmail, web3AuthUserId, chain } = req.body;
  
  const reference = new Keypair().publicKey;
  const amountBigNumber = new BigNumber(amount);
  
  // Create payment URL for Solana Pay
  const url = encodeURL({
    recipient: MERCHANT_WALLET,
    amount: amountBigNumber,
    reference,
    label,
    message,
    memo
  });

  // Save payment to database
  const paymentData = {
    reference: reference.toString(),
    web3auth_user_id: web3AuthUserId,
    amount: amount.toString(),
    currency: chain === 'solana' ? 'SOL' : 'ETH',
    chain,
    recipient_address: MERCHANT_WALLET.toString(),
    label,
    message,
    memo,
    status: 'pending',
    customer_email: customerEmail
  };

  const payment = await database.createPayment(paymentData);
  
  // Send email notification if email provided
  if (customerEmail) {
    try {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      await emailService.sendPaymentCreatedEmail({
        ...paymentData,
        paymentUrl: `${baseUrl}/payment/${reference}`
      }, customerEmail);
    } catch (emailError) {
      logger.warn('Failed to send payment created email:', emailError);
    }
  }

  logger.info('Payment created:', { reference: reference.toString(), amount, chain });

  res.json({
    success: true,
    reference: reference.toString(),
    url: url.toString(),
    payment
  });
});

/**
 * Get payment details by reference
 */
const getPayment = asyncHandler(async (req, res) => {
  const { reference } = req.params;
  const payment = await database.getPayment(reference);
  
  if (!payment) {
    return res.status(404).json({
      success: false,
      error: 'Payment not found'
    });
  }

  res.json({
    success: true,
    payment
  });
});

/**
 * Confirm payment transaction
 */
const confirmPayment = asyncHandler(async (req, res) => {
  const { reference, signature } = req.body;
  
  const payment = await database.getPayment(reference);
  if (!payment) {
    return res.status(404).json({
      success: false,
      error: 'Payment not found'
    });
  }

  if (payment.status === 'confirmed') {
    return res.json({
      success: true,
      message: 'Payment already confirmed',
      payment
    });
  }

  // Verify transaction on Solana
  const connection = establishConnection();
  const referencePublicKey = new PublicKey(reference);
  
  try {
    const signatureInfo = await findReference(connection, referencePublicKey, { finality: 'confirmed' });
    
    // Validate the transfer
    await validateTransfer(
      connection,
      signatureInfo.signature,
      {
        recipient: MERCHANT_WALLET,
        amount: new BigNumber(payment.amount),
        reference: referencePublicKey
      },
      { commitment: 'confirmed' }
    );

    // Update payment status
    const updatedPayment = await database.updatePaymentStatus(reference, 'confirmed', signature);
    
    // Send confirmation email
    if (payment.customer_email) {
      try {
        await emailService.sendPaymentConfirmedEmail(updatedPayment, payment.customer_email);
      } catch (emailError) {
        logger.warn('Failed to send payment confirmed email:', emailError);
      }
    }

    logger.info('Payment confirmed:', { reference, signature });

    res.json({
      success: true,
      message: 'Payment confirmed',
      payment: updatedPayment
    });

  } catch (verificationError) {
    logger.warn('Payment verification failed:', { reference, error: verificationError.message });
    
    await database.updatePaymentStatus(reference, 'failed');
    
    res.status(400).json({
      success: false,
      error: 'Payment verification failed'
    });
  }
});

/**
 * Get payment status
 */
const getPaymentStatus = asyncHandler(async (req, res) => {
  const { reference } = req.params;
  const payment = await database.getPayment(reference);
  
  if (!payment) {
    return res.status(404).json({
      success: false,
      error: 'Payment not found'
    });
  }

  res.json({
    success: true,
    status: payment.status,
    reference,
    transaction_signature: payment.transaction_signature
  });
});

/**
 * Send payment invoice via email
 */
const sendInvoice = asyncHandler(async (req, res) => {
  const { reference } = req.params;
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({
      success: false,
      error: 'Email is required'
    });
  }

  const payment = await database.getPayment(reference);
  if (!payment) {
    return res.status(404).json({
      success: false,
      error: 'Payment not found'
    });
  }

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  await emailService.sendPaymentInvoice(payment, email, baseUrl);

  logger.info('Invoice sent:', { reference, email });

  res.json({
    success: true,
    message: `Invoice sent to ${email}`
  });
});

/**
 * Manual confirm payment (for testing)
 */
const manualConfirmPayment = asyncHandler(async (req, res) => {
  const { reference } = req.params;
  const { signature } = req.body;
  
  const payment = await database.getPayment(reference);
  if (!payment) {
    return res.status(404).json({
      success: false,
      error: 'Payment not found'
    });
  }

  if (payment.status === 'confirmed') {
    return res.json({
      success: true,
      message: 'Payment already confirmed',
      payment
    });
  }

  // Update payment status
  const updatedPayment = await database.updatePaymentStatus(reference, 'confirmed', signature || 'manual-confirmation');
  
  // Create transaction record
  try {
    await database.getClient()
      .from('transactions')
      .insert({
        payment_id: payment.id,
        chain: payment.chain,
        transaction_hash: signature || 'manual-confirmation',
        status: 'confirmed',
        confirmed_at: new Date().toISOString()
      });
  } catch (txError) {
    logger.warn('Failed to create transaction record:', txError);
  }
  
  // Send confirmation email
  if (payment.customer_email) {
    try {
      await emailService.sendPaymentConfirmedEmail(updatedPayment, payment.customer_email);
      logger.info('Payment confirmation email sent:', { reference, email: payment.customer_email });
    } catch (emailError) {
      logger.warn('Failed to send payment confirmed email:', emailError);
    }
  }

  logger.info('Payment manually confirmed:', { reference, signature });

  res.json({
    success: true,
    message: 'Payment confirmed',
    payment: updatedPayment
  });
});

module.exports = {
  createPayment,
  getPayment,
  confirmPayment,
  manualConfirmPayment,
  getPaymentStatus,
  sendInvoice
};
