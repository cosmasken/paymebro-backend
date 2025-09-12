const { Keypair } = require('@solana/web3.js');
const crypto = require('crypto');
const database = require('./database');

class AddressService {
  /**
   * Generate unique payment address for a payment reference
   */
  async generatePaymentAddress(userId, internalReference) {
    try {
      // Generate fresh keypair
      const keypair = Keypair.generate();
      const address = keypair.publicKey.toString();

      // Encrypt private key for storage (optional - for recovery)
      const encryptedPrivateKey = this.encryptPrivateKey(keypair.secretKey, userId);

      // Store in database using Solana address as reference
      const { data } = await database.getClient()
        .from('payment_addresses')
        .insert({
          payment_reference: address, // Use Solana address as reference
          address: address,
          private_key_encrypted: encryptedPrivateKey,
          web3auth_user_id: userId
        })
        .select()
        .single();

      return {
        address,
        reference: address, // Return Solana address as reference
        userId
      };

    } catch (error) {
      throw new Error(`Failed to generate payment address: ${error.message}`);
    }
  }

  /**
   * Get address for payment reference
   */
  async getPaymentAddress(paymentReference) {
    const { data } = await database.getClient()
      .from('payment_addresses')
      .select('*')
      .eq('payment_reference', paymentReference)
      .single();

    return data;
  }



  /**
   * Encrypt private key for storage
   */
  encryptPrivateKey(privateKey, userId) {
    const key = crypto.scryptSync(userId, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(privateKey);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  }
}

module.exports = new AddressService();
