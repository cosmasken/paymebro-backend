const { Connection, PublicKey, VersionedTransaction, TransactionMessage, SystemProgram } = require('@solana/web3.js');
const { createTransferCheckedInstruction, getAccount, getAssociatedTokenAddress, getMint } = require('@solana/spl-token');
const BigNumber = require('bignumber.js');
const { MERCHANT_WALLET } = require('../modules/solana-payment-merchant-flow/constants');
const { establishConnection } = require('../modules/solana-payment-merchant-flow/establishConnection');
const database = require('../services/database');
const logger = require('../utils/logger');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * Handle GET request for transaction request metadata
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
    label: process.env.MERCHANT_NAME || 'Solana Pay Merchant',
    icon: process.env.MERCHANT_ICON || 'https://solanapay.com/src/img/branding/Solanapay.com.svg'
  };

  logger.info('Transaction request GET:', { reference, label: response.label });
  res.json(response);
});

/**
 * Handle POST request to create transaction
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
    const sender = new PublicKey(account);
    const connection = await establishConnection();
    
    let transaction;
    let message = `Payment of ${session.amount} ${session.currency}`;

    if (session.spl_token_mint) {
      // Create SPL token transaction
      transaction = await createSplTransaction(sender, session, connection);
      message = `Payment of ${session.amount} ${session.currency} tokens`;
    } else {
      // Create SOL transaction
      transaction = await createSolTransaction(sender, session, connection);
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

/**
 * Create SPL token transaction
 */
async function createSplTransaction(sender, session, connection) {
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
  const merchantATA = await getAssociatedTokenAddress(splToken, MERCHANT_WALLET);
  
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
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: sender,
      recentBlockhash: blockhash,
      instructions: [transferIx]
    }).compileToV0Message()
  );

  return transaction;
}

/**
 * Create SOL transaction
 */
async function createSolTransaction(sender, session, connection) {
  const amount = new BigNumber(session.amount);
  const lamports = amount.times(1e9).integerValue(BigNumber.ROUND_FLOOR);

  // Check sender balance
  const balance = await connection.getBalance(sender);
  if (BigInt(lamports.toString()) > balance) throw new Error('Insufficient SOL balance');

  // Create transfer instruction
  const transferIx = SystemProgram.transfer({
    fromPubkey: sender,
    toPubkey: MERCHANT_WALLET,
    lamports: BigInt(lamports.toString())
  });

  // Add reference
  const reference = new PublicKey(session.reference);
  transferIx.keys.push({ pubkey: reference, isWritable: false, isSigner: false });

  // Get recent blockhash
  const { blockhash } = await connection.getLatestBlockhash();

  // Create transaction
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: sender,
      recentBlockhash: blockhash,
      instructions: [transferIx]
    }).compileToV0Message()
  );

  return transaction;
}

module.exports = {
  getTransactionRequest,
  createTransaction
};
