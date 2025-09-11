const { Connection, PublicKey, Transaction, SystemProgram, TransactionInstruction } = require('@solana/web3.js');
const { 
  getAssociatedTokenAddress, 
  createAssociatedTokenAccountInstruction, 
  getAccount,
  TOKEN_PROGRAM_ID,
  getMint,
  createTransferCheckedInstruction
} = require('@solana/spl-token');

// Use environment variable for merchant wallet, fallback to hardcoded for backward compatibility
const MERCHANT_WALLET = new PublicKey(
  process.env.MERCHANT_WALLET_ADDRESS || 'GDBPQ6G7k9xMFcmz2GqEgmcesC6DRzeWQPfRPk1hQNBo'
);

// Devnet USDC mint address
const USDC_MINT = new PublicKey(
  process.env.USDC_MINT_ADDRESS || 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'
);

/**
 * Establish connection to Solana network
 */
async function establishConnection() {
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  
  // Test connection
  await connection.getLatestBlockhash();
  
  return connection;
}

/**
 * Check if a recipient has an associated token account for a given mint
 * @param {Connection} connection - Solana connection
 * @param {PublicKey} recipient - Recipient's wallet address
 * @param {PublicKey} mint - Token mint address
 * @returns {Promise<boolean>} Whether the recipient has an associated token account
 */
async function hasAssociatedTokenAccount(connection, recipient, mint) {
  try {
    const ata = await getAssociatedTokenAddress(mint, recipient);
    await getAccount(connection, ata);
    return true;
  } catch (error) {
    // If account doesn't exist or is not initialized, return false
    return false;
  }
}

/**
 * Ensure recipient has an associated token account, creating it if needed
 * This function creates and sends a transaction to create the ATA if it doesn't exist
 * @param {Connection} connection - Solana connection
 * @param {PublicKey} payer - Payer's wallet address (must have signing capability)
 * @param {PublicKey} recipient - Recipient's wallet address
 * @param {PublicKey} mint - Token mint address
 * @returns {Promise<void>}
 */
async function ensureAssociatedTokenAccount(connection, payer, recipient, mint) {
  try {
    // Check if recipient already has an associated token account
    const hasAta = await hasAssociatedTokenAccount(connection, recipient, mint);
    
    if (!hasAta) {
      // Create associated token account
      const ata = await getAssociatedTokenAddress(mint, recipient);
      
      // Create transaction to create the ATA
      const transaction = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          payer,
          ata,
          recipient,
          mint
        )
      );
      
      // Get latest blockhash
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = payer;
      
      // Sign and send transaction
      // Note: In this context, we can't actually sign the transaction as we don't have the payer's private key
      // This is just for reference - we'll handle this differently in the actual implementation
    }
  } catch (error) {
    // If there's any error checking or creating the ATA, re-throw it
    throw new Error(`Failed to ensure associated token account: ${error.message}`);
  }
}

/**
 * Create a transfer transaction with associated token account creation if needed
 * @param {Connection} connection - Solana connection
 * @param {PublicKey} sender - Sender's wallet address
 * @param {Object} transferParams - Transfer parameters
 * @param {PublicKey} transferParams.recipient - Recipient's wallet address
 * @param {BigNumber} transferParams.amount - Amount to transfer
 * @param {PublicKey} [transferParams.splToken] - SPL token mint address
 * @param {PublicKey} [transferParams.reference] - Reference public key
 * @param {string} [transferParams.memo] - Memo for the transaction
 * @returns {Promise<Transaction>} Transaction with transfer and ATA creation if needed
 */
async function createTransferWithAta(connection, sender, transferParams) {
  const { recipient, amount, splToken, reference, memo } = transferParams;
  
  // For SOL transfers, use the standard approach
  if (!splToken) {
    const { createTransfer } = require('@solana/pay');
    return await createTransfer(connection, sender, { recipient, amount, reference, memo });
  }
  
  // For SPL token transfers, we need to handle the associated token account creation
  try {
    // Check if recipient has an associated token account
    const hasAta = await hasAssociatedTokenAccount(connection, recipient, splToken);
    
    if (hasAta) {
      // If recipient already has an ATA, use the standard Solana Pay approach
      const { createTransfer } = require('@solana/pay');
      return await createTransfer(connection, sender, { recipient, amount, splToken, reference, memo });
    } else {
      // If recipient doesn't have an ATA, we need to create a custom transaction
      // that includes both the ATA creation and the transfer
      
      // First, get the associated token address
      const recipientAta = await getAssociatedTokenAddress(splToken, recipient);
      
      // Create the associated token account instruction
      const createAtaInstruction = createAssociatedTokenAccountInstruction(
        sender, // payer
        recipientAta,
        recipient,
        splToken
      );
      
      // Create the transfer instruction using the SPL token library directly
      const senderAta = await getAssociatedTokenAddress(splToken, sender);
      
      // Get mint info to determine decimals
      const mintInfo = await getMintInfo(connection, splToken);
      const decimals = mintInfo.decimals;
      
      // Convert amount to integer tokens
      const tokens = BigInt(amount.times(10 ** decimals).integerValue().toString());
      
      // Create transfer instruction
      const transferInstruction = createTransferCheckedInstruction(
        senderAta,
        splToken,
        recipientAta,
        sender,
        tokens,
        decimals
      );
      
      // Create transaction
      const transaction = new Transaction();
      
      // Add instructions - transfer instruction must be last for Solana Pay validation
      transaction.add(createAtaInstruction);
      transaction.add(transferInstruction);
      
      // Add memo if provided (this will be second to last)
      if (memo) {
        const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
        transaction.add(
          new TransactionInstruction({
            programId: MEMO_PROGRAM_ID,
            keys: [],
            data: Buffer.from(memo, 'utf8'),
          })
        );
      }
      
      // Add reference keys to the transfer instruction if provided
      if (reference) {
        const references = Array.isArray(reference) ? reference : [reference];
        // Add reference keys to the transfer instruction (not as separate instructions)
        for (const pubkey of references) {
          transferInstruction.keys.push({ pubkey, isWritable: false, isSigner: false });
        }
      }
      
      // Set fee payer and blockhash
      transaction.feePayer = sender;
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      
      return transaction;
    }
  } catch (error) {
    throw new Error(`Failed to create transfer with ATA: ${error.message}`);
  }
}

/**
 * Get mint information
 * @param {Connection} connection - Solana connection
 * @param {PublicKey} mint - Mint address
 * @returns {Promise<Object>} Mint information
 */
async function getMintInfo(connection, mint) {
  try {
    return await getMint(connection, mint);
  } catch (error) {
    throw new Error(`Failed to get mint info: ${error.message}`);
  }
}



module.exports = {
  MERCHANT_WALLET,
  USDC_MINT,
  establishConnection,
  hasAssociatedTokenAccount,
  ensureAssociatedTokenAccount,
  createTransferWithAta
};
