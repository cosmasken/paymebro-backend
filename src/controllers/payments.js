const { encodeURL, findReference, validateTransfer, TransactionRequestURLFields } = require('@solana/pay');
const { MERCHANT_WALLET, USDC_MINT, establishConnection } = require('../services/solana');
const BigNumber = require('bignumber.js');
const { Keypair, PublicKey } = require('@solana/web3.js');
const emailService = require('../services/emailService');
const database = require('../services/database');
const logger = require('../utils/logger');
const { asyncHandler } = require('../middleware/errorHandler');
const QRCode = require('qrcode');
const { notifyPaymentUpdate } = require('../services/websocket');
const DeterministicAddressService = require('../services/deterministicAddressService');

const deterministicService = new DeterministicAddressService();

/**
 * Create a new payment request with deterministic reference
 */
const createPayment = asyncHandler(async (req, res) => {
  const { amount, label, message, memo, customerEmail, web3AuthUserId, chain, splToken, merchantWallet } = req.body;

  // Verify user exists - don't create new users during payment creation
  const existingUser = await database.getUserById(web3AuthUserId);
  if (!existingUser) {
    logger.warn('Payment creation failed: User not found', { web3AuthUserId });
    return res.status(400).json({
      success: false,
      error: 'User not found. Please complete onboarding first.'
    });
  }

  // Check if user can create more payments (plan enforcement)
  const userPlan = await deterministicService.getUserPlan(web3AuthUserId);
  const canCreate = await deterministicService.canUserCreatePayment(web3AuthUserId, userPlan);
  
  if (!canCreate) {
    const monthlyCount = await deterministicService.getMonthlyPaymentCount(web3AuthUserId);
    const planLimits = { free: 100, pro: 1000, enterprise: 'unlimited' };
    const limit = planLimits[userPlan] || planLimits.free;
    
    logger.warn('Payment creation failed: Monthly limit exceeded', { 
      web3AuthUserId, 
      plan: userPlan, 
      monthlyCount, 
      limit 
    });
    
    return res.status(403).json({
      success: false,
      error: `Monthly payment limit exceeded (${monthlyCount}/${limit}). Upgrade your plan for more payments.`,
      details: {
        currentPlan: userPlan,
        monthlyUsage: monthlyCount,
        monthlyLimit: limit
      }
    });
  }

  // Generate deterministic reference address
  const addressInfo = await deterministicService.generatePaymentAddress(web3AuthUserId);
  const reference = new PublicKey(addressInfo.address);

  logger.info('Generated deterministic address', {
    reference: addressInfo.address,
    counter: addressInfo.counter,
    userId: web3AuthUserId
  });

  const amountBigNumber = new BigNumber(amount);

  // Use provided merchant wallet or user's default wallet
  const recipientWallet = merchantWallet ?
    new PublicKey(merchantWallet) :
    new PublicKey(existingUser.solana_address);

  // Only use USDC if explicitly specified via splToken parameter
  const tokenMint = splToken ? new PublicKey(splToken) : null;

  // Calculate fees and determine currency
  let feeAmount;
  let currency = 'SOL';
  
  if (tokenMint) {
    // Map common SPL token mints to their symbols
    const tokenMap = {
      'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr': 'USDC', // USDC devnet
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC', // USDC mainnet
    };
    currency = tokenMap[tokenMint.toString()] || 'SPL';
  }

  if (currency === 'USDC') {
    // 2.9% + $0.30
    const percentageFee = amountBigNumber.multipliedBy(0.029);
    const fixedFee = new BigNumber(0.30);
    feeAmount = percentageFee.plus(fixedFee);
  } else {
    // 2.9% + 0.002 SOL
    const percentageFee = amountBigNumber.multipliedBy(0.029);
    const fixedFee = new BigNumber(0.002);
    feeAmount = percentageFee.plus(fixedFee);
  }

  // Calculate merchant amount and total amount
  const merchantAmount = amountBigNumber;
  const totalAmountPaid = merchantAmount.plus(feeAmount);

  // Create transaction request URL (for QR code compatibility)
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const transactionRequestUrl = `${baseUrl}/api/transaction-requests/${reference}`;

  // Create Solana Pay transaction request URL
  const urlFields = { link: new URL(transactionRequestUrl) };
  const url = encodeURL(urlFields);

  // Save payment to database with deterministic address info
  const paymentData = {
    reference: reference.toString(),
    web3auth_user_id: web3AuthUserId,
    amount: merchantAmount.toString(),
    fee_amount: feeAmount.toString(),
    merchant_amount: merchantAmount.toString(),
    total_amount_paid: totalAmountPaid.toString(),
    currency,
    chain,
    recipient_address: recipientWallet.toString(),
    label,
    message,
    memo,
    status: 'pending',
    customer_email: customerEmail,
    spl_token_mint: tokenMint ? tokenMint.toString() : null,
    payment_counter: addressInfo.counter,
    derivation_path: addressInfo.derivationPath
  };

  let payment;
  try {
    payment = await database.createPayment(paymentData);
  } catch (dbError) {
    logger.error('Payment creation failed in database:', {
      web3AuthUserId,
      amount,
      currency,
      error: dbError.message,
      code: dbError.code
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to create payment in database',
      details: process.env.NODE_ENV === 'development' ? dbError.message : undefined
    });
  }

  // Send email notification if email provided
  if (customerEmail) {
    try {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      await emailService.sendPaymentCreatedEmail({
        ...paymentData,
        paymentUrl: `${baseUrl}/payment/${reference}`
      }, customerEmail);
    } catch (emailError) {
      logger.warn('Failed to send payment created email:', {
        error: emailError.message,
        email: customerEmail,
        reference: reference.toString()
      });
    }
  }

  logger.info('Payment created:', { reference: reference.toString(), amount, currency, feeAmount: feeAmount.toString() });

  // Generate base URL for payment links
  // const baseUrl = `${req.protocol}://${req.get('host')}`;
  const paymentUrl = `${baseUrl}/payment/${reference}`;

  res.json({
    success: true,
    reference: reference.toString(),
    url: url.toString(),
    paymentUrl: paymentUrl,
    payment
  });
});

/**
 * Get payment details by reference
 */
const getPayment = asyncHandler(async (req, res) => {
  const { reference } = req.params;

  try {
    const payment = await database.getPayment(reference);

    if (!payment) {
      logger.info('Payment not found:', { reference });
      return res.status(404).json({
        success: false,
        error: 'Payment not found'
      });
    }

    res.json({
      success: true,
      payment
    });
  } catch (dbError) {
    logger.error('Error retrieving payment:', {
      reference,
      error: dbError.message,
      code: dbError.code
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve payment',
      details: process.env.NODE_ENV === 'development' ? dbError.message : undefined
    });
  }
});

/**
 * Generate QR code for payment
 */
const generatePaymentQR = asyncHandler(async (req, res) => {
  const { reference } = req.params;

  // Get payment details with error handling
  let payment;
  try {
    payment = await database.getPayment(reference);
  } catch (dbError) {
    logger.error('Error retrieving payment for QR code:', {
      reference,
      error: dbError.message,
      code: dbError.code
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve payment',
      details: process.env.NODE_ENV === 'development' ? dbError.message : undefined
    });
  }

  if (!payment) {
    logger.info('Payment not found for QR code:', { reference });
    return res.status(404).json({
      success: false,
      error: 'Payment not found'
    });
  }

  try {
    // Create transaction request URL for QR code
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const transactionRequestUrl = `${baseUrl}/api/transaction-requests/${payment.reference}`;

    // Create Solana Pay transaction request URL
    const urlFields = { link: new URL(transactionRequestUrl) };
    const url = encodeURL(urlFields);

    // Generate QR code as Data URI (base64)
    const qrCodeDataUri = await QRCode.toDataURL(url.toString(), {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });

    // Send the QR code as Data URI
    res.json({
      success: true,
      qrCode: qrCodeDataUri
    });
  } catch (error) {
    logger.error('Failed to generate QR code:', {
      reference,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: 'Failed to generate QR code',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Confirm payment transaction
 */
const confirmPayment = asyncHandler(async (req, res) => {
  const { reference, signature } = req.body;

  // Get payment with error handling
  let payment;
  try {
    payment = await database.getPayment(reference);
  } catch (dbError) {
    logger.error('Error retrieving payment for confirmation:', {
      reference,
      error: dbError.message,
      code: dbError.code
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve payment',
      details: process.env.NODE_ENV === 'development' ? dbError.message : undefined
    });
  }

  if (!payment) {
    logger.info('Payment not found for confirmation:', { reference });
    return res.status(404).json({
      success: false,
      error: 'Payment not found'
    });
  }

  if (payment.status === 'confirmed') {
    logger.info('Payment already confirmed:', { reference });
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
    const validateParams = {
      recipient: MERCHANT_WALLET,
      amount: new BigNumber(payment.amount),
      reference: referencePublicKey
    };

    // Add SPL token if payment uses one
    if (payment.spl_token_mint) {
      validateParams.splToken = new PublicKey(payment.spl_token_mint);
    }

    await validateTransfer(
      connection,
      signatureInfo.signature,
      validateParams,
      { commitment: 'confirmed' }
    );

    // Update payment status with error handling
    let updatedPayment;
    try {
      updatedPayment = await database.updatePaymentStatus(reference, 'confirmed', signature);
    } catch (dbError) {
      logger.error('Error updating payment status:', {
        reference,
        status: 'confirmed',
        error: dbError.message,
        code: dbError.code
      });
      return res.status(500).json({
        success: false,
        error: 'Failed to update payment status',
        details: process.env.NODE_ENV === 'development' ? dbError.message : undefined
      });
    }

    // Update analytics summary
    try {
      await database.getClient().rpc('update_payment_analytics', {
        p_payment_id: updatedPayment.id
      });
    } catch (analyticsError) {
      logger.warn('Analytics update failed:', {
        reference,
        error: analyticsError.message
      });
    }

    // Send confirmation email
    if (payment.customer_email) {
      try {
        await emailService.sendPaymentConfirmedEmail(updatedPayment, payment.customer_email);
      } catch (emailError) {
        logger.warn('Failed to send payment confirmed email:', {
          reference,
          email: payment.customer_email,
          error: emailError.message
        });
      }
    }

    // Send WebSocket notification with detailed info
    const wsResult = notifyPaymentUpdate(reference, 'confirmed', {
      signature: signatureInfo.signature,
      payment: updatedPayment,
      amount: parseFloat(payment.amount),
      currency: payment.currency
    });

    if (!wsResult.success) {
      logger.warn('Failed to send WebSocket notification:', {
        reference,
        error: wsResult.error
      });
    }

    logger.info('Payment confirmed:', { reference, signature: signatureInfo.signature });

    res.json({
      success: true,
      message: 'Payment confirmed',
      payment: updatedPayment
    });

  } catch (verificationError) {
    logger.warn('Payment verification failed:', {
      reference,
      error: verificationError.message,
      stack: verificationError.stack
    });

    // Update payment status to failed
    try {
      await database.updatePaymentStatus(reference, 'failed');
    } catch (dbError) {
      logger.error('Error updating payment status to failed:', {
        reference,
        status: 'failed',
        error: dbError.message,
        code: dbError.code
      });
    }

    // Send WebSocket notification
    const wsResult = notifyPaymentUpdate(reference, 'failed', {
      error: verificationError.message
    });

    if (!wsResult.success) {
      logger.warn('Failed to send WebSocket notification:', {
        reference,
        error: wsResult.error
      });
    }

    res.status(400).json({
      success: false,
      error: 'Payment verification failed',
      details: process.env.NODE_ENV === 'development' ? verificationError.message : undefined
    });
  }
});

/**
 * Get payment status
 */
const getPaymentStatus = asyncHandler(async (req, res) => {
  const { reference } = req.params;

  try {
    const payment = await database.getPayment(reference);

    if (!payment) {
      logger.info('Payment not found for status check:', { reference });
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
  } catch (dbError) {
    logger.error('Error retrieving payment status:', {
      reference,
      error: dbError.message,
      code: dbError.code
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve payment status',
      details: process.env.NODE_ENV === 'development' ? dbError.message : undefined
    });
  }
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

  // Get payment with error handling
  let payment;
  try {
    payment = await database.getPayment(reference);
  } catch (dbError) {
    logger.error('Error retrieving payment for invoice:', {
      reference,
      error: dbError.message,
      code: dbError.code
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve payment',
      details: process.env.NODE_ENV === 'development' ? dbError.message : undefined
    });
  }

  if (!payment) {
    logger.info('Payment not found for invoice:', { reference });
    return res.status(404).json({
      success: false,
      error: 'Payment not found'
    });
  }

  // const baseUrl = `${req.protocol}://${req.get('host')}`;

  try {
    await emailService.sendPaymentInvoice(payment, email, baseUrl);
  } catch (emailError) {
    logger.error('Failed to send payment invoice:', {
      reference,
      email,
      error: emailError.message
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to send invoice email',
      details: process.env.NODE_ENV === 'development' ? emailError.message : undefined
    });
  }

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

  // Get payment with error handling
  let payment;
  try {
    payment = await database.getPayment(reference);
  } catch (dbError) {
    logger.error('Error retrieving payment for manual confirmation:', {
      reference,
      error: dbError.message,
      code: dbError.code
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve payment',
      details: process.env.NODE_ENV === 'development' ? dbError.message : undefined
    });
  }

  if (!payment) {
    logger.info('Payment not found for manual confirmation:', { reference });
    return res.status(404).json({
      success: false,
      error: 'Payment not found'
    });
  }

  if (payment.status === 'confirmed') {
    logger.info('Payment already confirmed (manual):', { reference });
    return res.json({
      success: true,
      message: 'Payment already confirmed',
      payment
    });
  }

  // Update payment status with error handling
  let updatedPayment;
  try {
    updatedPayment = await database.updatePaymentStatus(reference, 'confirmed', signature || 'manual-confirmation');
  } catch (dbError) {
    logger.error('Error updating payment status (manual):', {
      reference,
      status: 'confirmed',
      error: dbError.message,
      code: dbError.code
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to update payment status',
      details: process.env.NODE_ENV === 'development' ? dbError.message : undefined
    });
  }

  // Update analytics summary
  try {
    await database.getClient().rpc('update_payment_analytics', {
      p_payment_id: updatedPayment.id
    });
  } catch (analyticsError) {
    logger.warn('Analytics update failed (manual):', {
      reference,
      error: analyticsError.message
    });
  }

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
    logger.warn('Failed to create transaction record (manual):', {
      reference,
      error: txError.message
    });
  }

  // Send confirmation email
  if (payment.customer_email) {
    try {
      await emailService.sendPaymentConfirmedEmail(updatedPayment, payment.customer_email);
      logger.info('Payment confirmation email sent (manual):', { reference, email: payment.customer_email });
    } catch (emailError) {
      logger.warn('Failed to send payment confirmed email (manual):', {
        reference,
        email: payment.customer_email,
        error: emailError.message
      });
    }
  }

  // Send WebSocket notification
  const wsResult = notifyPaymentUpdate(reference, 'confirmed', {
    signature: signature || 'manual-confirmation',
    payment: updatedPayment
  });

  if (!wsResult.success) {
    logger.warn('Failed to send WebSocket notification (manual):', {
      reference,
      error: wsResult.error
    });
  }

  logger.info('Payment manually confirmed:', { reference, signature });

  res.json({
    success: true,
    message: 'Payment confirmed',
    payment: updatedPayment
  });
});

/**
 * Handle GET request for transaction request metadata (consolidated from transactionRequests)
 */
const getTransactionRequest = asyncHandler(async (req, res) => {
  const { reference } = req.params;
  
  // Validate reference exists in database
  const session = await database.getPayment(reference);
  if (!session) {
    return res.status(404).json({
      error: 'Transaction request not found'
    });
  }

  // Return merchant info for wallet display
  const response = {
    label: process.env.MERCHANT_NAME || 'PayMeBro',
    icon: process.env.MERCHANT_ICON || 'https://raw.githubusercontent.com/vybzcody/paymebro/main/public/afripay.png'
  };

  logger.info('Transaction request GET:', { reference, label: response.label });
  res.json(response);
});

/**
 * Handle POST request to create transaction (consolidated from transactionRequests)
 */
const createTransaction = asyncHandler(async (req, res) => {
  const { reference } = req.params;
  const { account } = req.body;

  if (!account) {
    return res.status(400).json({
      error: 'Missing account field'
    });
  }

  // Get session details
  const session = await database.getPayment(reference);
  if (!session) {
    return res.status(404).json({
      error: 'Transaction request not found'
    });
  }

  if (session.status !== 'pending') {
    return res.status(400).json({
      error: 'Transaction request already processed'
    });
  }

  try {
    const { Connection, PublicKey, VersionedTransaction, TransactionMessage, SystemProgram } = require('@solana/web3.js');
    const { createTransferCheckedInstruction, getAccount, getAssociatedTokenAddress, getMint } = require('@solana/spl-token');
    const { MERCHANT_WALLET } = require('../services/solana');
    
    const sender = new PublicKey(account);
    const connection = await establishConnection();
    
    let transaction;
    let message = `Payment of ${session.amount} ${session.currency}`;

    if (session.spl_token_mint) {
      // Create SPL token transaction
      const splToken = new PublicKey(session.spl_token_mint);
      const amount = new BigNumber(session.amount);

      // Get mint info
      const mint = await getMint(connection, splToken);
      if (!mint.isInitialized) throw new Error('Token mint not initialized');

      // Calculate amount with decimals
      const tokens = amount.times(new BigNumber(10).pow(mint.decimals)).integerValue(BigNumber.ROUND_FLOOR);

      // Get sender's token account
      const senderATA = await getAssociatedTokenAddress(splToken, sender);
      
      try {
        const senderAccount = await getAccount(connection, senderATA);
        if (!senderAccount.isInitialized) throw new Error('Sender token account not found');
        if (senderAccount.isFrozen) throw new Error('Sender token account is frozen');
        if (BigInt(tokens.toString()) > senderAccount.amount) throw new Error('Insufficient token balance');
      } catch (error) {
        if (error.name === 'TokenAccountNotFoundError') {
          throw new Error('Sender does not have a USDC token account');
        }
        throw error;
      }

      // Get merchant's token account
      const merchantWallet = new PublicKey(session.recipient_address || MERCHANT_WALLET.toString());
      const merchantATA = await getAssociatedTokenAddress(splToken, merchantWallet);
      
      // Create transfer instruction
      const transferIx = createTransferCheckedInstruction(
        senderATA,
        splToken,
        merchantATA,
        sender,
        BigInt(tokens.toString()),
        mint.decimals
      );

      // Add reference
      const reference = new PublicKey(session.reference);
      transferIx.keys.push({ pubkey: reference, isWritable: false, isSigner: false });

      // Get recent blockhash
      const { blockhash } = await connection.getLatestBlockhash();

      // Create transaction
      transaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: sender,
          recentBlockhash: blockhash,
          instructions: [transferIx]
        }).compileToV0Message()
      );

      message = `Payment of ${session.amount} ${session.currency} tokens`;
    } else {
      // Create SOL transaction
      const amount = new BigNumber(session.amount);
      const lamports = amount.times(1e9).integerValue(BigNumber.ROUND_FLOOR);

      // Check sender balance
      const balance = await connection.getBalance(sender);
      if (BigInt(lamports.toString()) > balance) throw new Error('Insufficient SOL balance');

      // Create transfer instruction
      const merchantWallet = new PublicKey(session.recipient_address || MERCHANT_WALLET.toString());
      const transferIx = SystemProgram.transfer({
        fromPubkey: sender,
        toPubkey: merchantWallet,
        lamports: BigInt(lamports.toString())
      });

      // Add reference
      const reference = new PublicKey(session.reference);
      transferIx.keys.push({ pubkey: reference, isWritable: false, isSigner: false });

      // Get recent blockhash
      const { blockhash } = await connection.getLatestBlockhash();

      // Create transaction
      transaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: sender,
          recentBlockhash: blockhash,
          instructions: [transferIx]
        }).compileToV0Message()
      );
    }

    const serializedTransaction = transaction.serialize();
    const base64Transaction = Buffer.from(serializedTransaction).toString('base64');

    logger.info('Transaction created:', { reference, account, type: session.spl_token_mint ? 'SPL' : 'SOL' });

    res.json({
      transaction: base64Transaction,
      message
    });

  } catch (error) {
    logger.error('Transaction creation failed:', { reference, error: error.message });
    res.status(400).json({
      error: error.message
    });
  }
});

module.exports = {
  createPayment,
  getPayment,
  generatePaymentQR,
  confirmPayment,
  manualConfirmPayment,
  getPaymentStatus,
  sendInvoice,
  getTransactionRequest,
  createTransaction
};
