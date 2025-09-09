const { Connection, PublicKey } = require('@solana/web3.js');

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

module.exports = {
  MERCHANT_WALLET,
  USDC_MINT,
  establishConnection
};
