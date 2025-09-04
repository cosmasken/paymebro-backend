import express from 'express';
import cors from 'cors';
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, TransactionInstruction } from '@solana/web3.js';
import { createTransferCheckedInstruction, getAssociatedTokenAddress, getMint } from '@solana/spl-token';
import { createClient } from '@supabase/supabase-js';
import BigNumber from 'bignumber.js';
import QRCode from 'qrcode';
import axios from 'axios';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
import { Resend } from 'resend';

dotenv.config();

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// Environment variable validation with defaults
const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'https://api.devnet.solana.com';
const USDC_MINT_ADDRESS = process.env.USDC_MINT || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const PLATFORM_WALLET = process.env.AFRIPAY_PLATFORM_WALLET || 'EHwtMrGE6V5fH3xUKYcoHzbouUqfgB4jd7MsqfQfHVSn';
const FEE_RATE = process.env.AFRIPAY_FEE_RATE || '0.029';
const FIXED_FEE = process.env.AFRIPAY_FIXED_FEE_USD || '0.30';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

console.log('🔗 RPC Endpoint:', RPC_ENDPOINT);

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize services
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const connection = new Connection(RPC_ENDPOINT);
const USDC_MINT = new PublicKey(USDC_MINT_ADDRESS);
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// Middleware
app.use(cors());
app.use(express.json());

// Price service
class PriceService {
  constructor() {
    this.prices = null;
    this.lastFetch = 0;
    this.CACHE_DURATION = 60000;
  }

  async getSOLPrice() {
    const now = Date.now();
    if (this.prices && (now - this.lastFetch) < this.CACHE_DURATION) {
      return this.prices.solana.usd;
    }

    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      this.prices = response.data;
      this.lastFetch = now;
      return this.prices.solana.usd;
    } catch (error) {
      console.error('Price fetch failed:', error);
      return 130;
    }
  }
}

const priceService = new PriceService();

// Utility functions
const createMemoInstruction = (memo, signers) => {
  return new TransactionInstruction({
    keys: signers.map(signer => ({
      pubkey: signer,
      isSigner: true,
      isWritable: false,
    })),
    data: Buffer.from(memo, 'utf8'),
    programId: MEMO_PROGRAM_ID,
  });
};

const addReferenceToInstruction = (instruction, reference) => {
  instruction.keys.push({
    pubkey: new PublicKey(reference),
    isSigner: false,
    isWritable: false,
  });
};

// PAYMENT PROCESSING ENDPOINTS

// Create payment
app.post('/api/payments', async (req, res) => {
  try {
    const { amount, currency = 'SOL', description, merchantWallet, userId, title } = req.body;

    if (!amount || !merchantWallet || !userId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const reference = randomUUID();
    const baseAmount = BigNumber(amount);
    const feeRate = BigNumber(FEE_RATE);
    const fixedFee = BigNumber(FIXED_FEE);

    const feeAmount = baseAmount.multipliedBy(feeRate).plus(fixedFee);
    const totalAmount = baseAmount.plus(feeAmount);

    const paymentData = {
      user_id: userId,
      reference,
      amount: baseAmount.toNumber(),
      currency,
      status: 'pending',
      recipient_wallet: merchantWallet,
      total_amount_paid: totalAmount.toNumber(),
      merchant_amount: baseAmount.toNumber(),
      fee_amount: feeAmount.toNumber(),
      description: description || `Payment of ${amount} ${currency}`,
      created_at: new Date().toISOString()
    };

    const { data: payment, error } = await supabase
      .from('payments')
      .insert(paymentData)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      payment,
      reference,
      paymentUrl: `solana:${process.env.BACKEND_URL}/api/solana-pay/transaction?reference=${reference}`,
      feeBreakdown: {
        merchantReceives: baseAmount.toNumber(),
        platformFee: feeAmount.toNumber(),
        total: totalAmount.toNumber()
      }
    });

  } catch (error) {
    console.error('Payment creation error:', error);
    res.status(500).json({ error: 'Failed to create payment' });
  }
});

// Get payment URL statistics
app.get('/api/payment-urls/:reference/stats', async (req, res) => {
  try {
    const { reference } = req.params;

    const { data: paymentUrl } = await supabase
      .from('payment_links')
      .select('*')
      .eq('reference', reference)
      .single();

    if (!paymentUrl) {
      return res.status(404).json({ error: 'Payment URL not found' });
    }

    const { data: payments } = await supabase
      .from('payments')
      .select('*')
      .eq('parent_reference', reference)
      .order('created_at', { ascending: false });

    res.json({
      success: true,
      paymentUrl,
      stats: {
        totalPayments: payments?.length || 0,
        totalCollected: payments?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0,
        recentPayments: payments?.slice(0, 10) || []
      }
    });

  } catch (error) {
    console.error('Payment URL stats error:', error);
    res.status(500).json({ error: 'Failed to get payment URL stats' });
  }
});


// Track payment (webhook simulation)
app.post('/api/payments/:reference/confirm', async (req, res) => {
  try {
    const { reference } = req.params;
    const { signature } = req.body;

    const { data: payment, error } = await supabase
      .from('payments')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        transaction_signature: signature
      })
      .eq('reference', reference)
      .select()
      .single();

    if (error) throw error;

    // Update parent payment URL usage count
    if (payment.parent_reference) {
      await supabase
        .from('payment_links')
        .update({
          use_count: supabase.raw('use_count + 1'),
          total_collected: supabase.raw(`total_collected + ${payment.amount}`)
        })
        .eq('reference', payment.parent_reference);

      // Get merchant email for notification
      const { data: paymentUrl } = await supabase
        .from('payment_links')
        .select('description, title')
        .eq('reference', payment.parent_reference)
        .single();

      // Send merchant notification
      const emailMatch = paymentUrl?.description?.match(/Email: ([^\s|]+)/);
      if (emailMatch && emailMatch[1] !== 'none') {
        try {
          await axios.post('http://localhost:3001/api/notify-merchant', {
            email: emailMatch[1],
            payment: {
              amount: payment.amount,
              currency: payment.currency,
              reference: payment.reference,
              signature: signature,
              title: paymentUrl.title
            }
          });
        } catch (notifyError) {
          console.error('Merchant notification failed:', notifyError);
        }
      }
    }

    console.log(`Payment confirmed: ${reference}`);

    res.json({ success: true, payment });

  } catch (error) {
    console.error('Payment confirmation error:', error);
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

// Merchant notification endpoint
app.post('/api/notify-merchant', async (req, res) => {
  try {
    const { email, payment } = req.body;

    // Simple email notification (replace with actual email service)
    console.log(`📧 Merchant Notification:
      To: ${email}
      Payment: ${payment.amount} ${payment.currency}
      Reference: ${payment.reference}
      Signature: ${payment.signature}
      Title: ${payment.title}
    `);

    // TODO: Implement actual email sending with Resend
    // await sendPaymentNotification(email, payment);

    res.json({ success: true, notified: true });

  } catch (error) {
    console.error('Merchant notification error:', error);
    res.status(500).json({ error: 'Failed to notify merchant' });
  }
});

// SOLANA PAY INTEGRATION

// Solana Pay transaction request
app.get('/api/solana-pay/transaction', async (req, res) => {
  try {
    const { reference } = req.query;
    if (!reference) {
      return res.status(400).json({ error: 'Missing reference parameter' });
    }

    const { data: payment } = await supabase
      .from('payments')
      .select('*')
      .eq('reference', reference)
      .single();

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    res.json({
      label: payment.merchant_name || 'MVP Payment',
      icon: 'https://mvp-server.com/icon.png',
    });

  } catch (error) {
    console.error('GET transaction error:', error);
    res.status(500).json({ error: 'Failed to get transaction details' });
  }
});

app.post('/api/solana-pay/transaction', async (req, res) => {
  try {
    const reference = req.query.reference || req.body.reference;
    const { account } = req.body;

    if (!account || !reference) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const buyerPublicKey = new PublicKey(account);

    const { data: payment } = await supabase
      .from('payments')
      .select('*')
      .eq('reference', reference)
      .eq('status', 'pending')
      .single();

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found or already processed' });
    }

    const recipientPublicKey = new PublicKey(payment.recipient_wallet);
    const transaction = new Transaction();

    if (payment.memo) {
      const memoInstruction = createMemoInstruction(payment.memo, [buyerPublicKey]);
      transaction.add(memoInstruction);
    }

    const bigAmount = BigNumber(payment.total_amount_paid);

    if (payment.currency === 'USDC') {
      const buyerTokenAccount = await getAssociatedTokenAddress(USDC_MINT, buyerPublicKey);
      const recipientTokenAccount = await getAssociatedTokenAddress(USDC_MINT, recipientPublicKey);

      const usdcMint = await getMint(connection, USDC_MINT);

      const transferInstruction = createTransferCheckedInstruction(
        buyerTokenAccount,
        USDC_MINT,
        recipientTokenAccount,
        buyerPublicKey,
        bigAmount.multipliedBy(10 ** usdcMint.decimals).toNumber(),
        usdcMint.decimals
      );

      addReferenceToInstruction(transferInstruction, reference);
      transaction.add(transferInstruction);

    } else {
      const SOL_PRICE_USD = await priceService.getSOLPrice();
      const solAmount = bigAmount.dividedBy(SOL_PRICE_USD);
      const lamports = solAmount.multipliedBy(LAMPORTS_PER_SOL).toNumber();

      const transferInstruction = SystemProgram.transfer({
        fromPubkey: buyerPublicKey,
        toPubkey: recipientPublicKey,
        lamports: Math.floor(lamports),
      });

      addReferenceToInstruction(transferInstruction, reference);
      transaction.add(transferInstruction);
    }

    const { blockhash } = await connection.getLatestBlockhash('finalized');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = buyerPublicKey;

    const serializedTransaction = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    res.json({
      transaction: serializedTransaction.toString('base64'),
      message: payment.description || `Pay ${payment.amount} ${payment.currency}`,
    });

  } catch (error) {
    console.error('POST transaction error:', error);
    res.status(500).json({ error: 'Failed to create transaction' });
  }
});

// CCTP CROSS-CHAIN SERVICE

// Initiate CCTP transfer
app.post('/api/cctp/transfer', async (req, res) => {
  try {
    const { amount, fromChain, toChain, recipient, burnTxHash } = req.body;

    if (!amount || !fromChain || !toChain || !recipient) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const transferData = {
      id: randomUUID(),
      amount: parseFloat(amount),
      from_chain: fromChain,
      to_chain: toChain,
      recipient_address: recipient,
      burn_tx_hash: burnTxHash,
      status: 'pending',
      created_at: new Date().toISOString()
    };

    const { data: transfer, error } = await supabase
      .from('cctp_transfers')
      .insert(transferData)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, transfer });

  } catch (error) {
    console.error('CCTP transfer error:', error);
    res.status(500).json({ error: 'Failed to initiate CCTP transfer' });
  }
});

// Monitor CCTP transfer
app.get('/api/cctp/transfer/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: transfer, error } = await supabase
      .from('cctp_transfers')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !transfer) {
      return res.status(404).json({ error: 'Transfer not found' });
    }

    // Check attestation if pending
    if (transfer.status === 'pending' && transfer.burn_tx_hash) {
      try {
        const attestationUrl = `${process.env.CIRCLE_API_URL}/messages/${transfer.from_chain}?transactionHash=${transfer.burn_tx_hash}`;
        const response = await axios.get(attestationUrl);
        const attestation = response.data?.messages?.[0];

        if (attestation?.status === 'complete') {
          await supabase
            .from('cctp_transfers')
            .update({
              status: 'ready_to_mint',
              attestation: attestation.attestation
            })
            .eq('id', id);

          transfer.status = 'ready_to_mint';
          transfer.attestation = attestation.attestation;
        }
      } catch (attestationError) {
        console.error('Attestation check failed:', attestationError);
      }
    }

    res.json(transfer);

  } catch (error) {
    console.error('CCTP transfer status error:', error);
    res.status(500).json({ error: 'Failed to get transfer status' });
  }
});

// BUSINESS & MERCHANT FEATURES

// Create invoice
app.post('/api/invoices', async (req, res) => {
  try {
    const { amount, currency, description, customerEmail, dueDate, merchantId } = req.body;

    if (!amount || !currency || !merchantId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const invoiceId = randomUUID();
    const reference = randomUUID();
    const baseAmount = BigNumber(amount);
    const feeRate = BigNumber(FEE_RATE);
    const fixedFee = BigNumber(FIXED_FEE);
    const feeAmount = baseAmount.multipliedBy(feeRate).plus(fixedFee);
    const totalAmount = baseAmount.plus(feeAmount);

    // Create invoice record
    const invoiceData = {
      id: invoiceId,
      user_id: merchantId,
      reference,
      amount: parseFloat(amount),
      currency,
      description,
      customer_email: customerEmail,
      due_date: dueDate,
      status: 'pending',
      created_at: new Date().toISOString()
    };

    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .insert(invoiceData)
      .select()
      .single();

    if (invoiceError) throw invoiceError;

    // Create corresponding payment record for Solana Pay
    const paymentData = {
      user_id: merchantId,
      reference,
      amount: baseAmount.toNumber(),
      currency,
      status: 'pending',
      recipient_wallet: PLATFORM_WALLET,
      total_amount_paid: totalAmount.toNumber(),
      merchant_amount: baseAmount.toNumber(),
      fee_amount: feeAmount.toNumber(),
      description: `Invoice: ${description || 'Payment'}`,
      customer_email: customerEmail,
      created_at: new Date().toISOString()
    };

    const { error: paymentError } = await supabase
      .from('payments')
      .insert(paymentData);

    if (paymentError) throw paymentError;

    const paymentUrl = `solana:${BACKEND_URL}/api/solana-pay/transaction?reference=${reference}`;

    // Send invoice email if customer email provided
    if (customerEmail) {
      try {
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL || 'PayMeBro <payments@payments.paymebro.xyz>',
          to: customerEmail,
          subject: `Invoice - ${amount} ${currency}`,
          html: `
            <h2>Invoice from PayMeBro</h2>
            <p><strong>Amount:</strong> ${amount} ${currency}</p>
            <p><strong>Description:</strong> ${description || 'Payment'}</p>
            <p><strong>Invoice ID:</strong> ${invoiceId}</p>
            <br>
            <p>To pay this invoice, use your Solana wallet with this payment URL:</p>
            <p><code>${paymentUrl}</code></p>
            <br>
            <p>Or visit: <a href="${FRONTEND_URL}/invoice/${invoiceId}">View Invoice</a></p>
          `
        });
        console.log(`✅ Invoice email sent to ${customerEmail}`);
      } catch (emailError) {
        console.error('❌ Email send failed:', emailError);
      }
    }

    res.json({
      success: true,
      invoice,
      paymentUrl,
      invoiceUrl: `${FRONTEND_URL}/invoice/${invoiceId}`
    });

  } catch (error) {
    console.error('Invoice creation error:', error);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

// Create multi-use payment URL
app.post('/api/payment-urls', async (req, res) => {
  try {
    const { title, amount, currency, description, merchantId, merchantEmail, maxUses } = req.body;

    if (!title || !amount || !currency || !merchantId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const reference = randomUUID();
    const paymentUrl = `solana:${process.env.BACKEND_URL}/api/solana-pay/multi-transaction?reference=${reference}`;

    const urlData = {
      user_id: merchantId,
      title,
      reference,
      amount: parseFloat(amount),
      currency,
      payment_url: paymentUrl,
      description: merchantEmail ? `${description || ''} | Email: ${merchantEmail}` : description,
      max_uses: maxUses || null,
      is_active: true,
      created_at: new Date().toISOString()
    };

    const { data: paymentUrlRecord, error } = await supabase
      .from('payment_links')
      .insert(urlData)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      paymentUrl: paymentUrlRecord,
      shareUrl: `${process.env.FRONTEND_URL}/pay/${reference}`,
      solanaPay: paymentUrl
    });

  } catch (error) {
    console.error('Multi-use payment URL creation error:', error);
    res.status(500).json({ error: 'Failed to create payment URL' });
  }
});

// Multi-use Solana Pay transaction
app.get('/api/solana-pay/multi-transaction', async (req, res) => {
  try {
    const { reference } = req.query;
    if (!reference) {
      return res.status(400).json({ error: 'Missing reference parameter' });
    }

    const { data: paymentUrl } = await supabase
      .from('payment_links')
      .select('*')
      .eq('reference', reference)
      .eq('is_active', true)
      .single();

    if (!paymentUrl) {
      return res.status(404).json({ error: 'Payment URL not found or inactive' });
    }

    if (paymentUrl.max_uses && paymentUrl.use_count >= paymentUrl.max_uses) {
      return res.status(400).json({ error: 'Payment URL usage limit reached' });
    }

    res.json({
      label: paymentUrl.title,
      icon: 'https://mvp-server.com/icon.png',
    });

  } catch (error) {
    console.error('Multi-transaction GET error:', error);
    res.status(500).json({ error: 'Failed to get transaction details' });
  }
});

app.post('/api/solana-pay/multi-transaction', async (req, res) => {
  try {
    const reference = req.query.reference || req.body.reference;
    const { account } = req.body;

    if (!account || !reference) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const buyerPublicKey = new PublicKey(account);

    const { data: paymentUrl } = await supabase
      .from('payment_links')
      .select('*')
      .eq('reference', reference)
      .eq('is_active', true)
      .single();

    if (!paymentUrl) {
      return res.status(404).json({ error: 'Payment URL not found or inactive' });
    }

    if (paymentUrl.max_uses && paymentUrl.use_count >= paymentUrl.max_uses) {
      return res.status(400).json({ error: 'Payment URL usage limit reached' });
    }

    // Create individual payment record
    const paymentReference = randomUUID();
    const baseAmount = BigNumber(paymentUrl.amount);
    const feeRate = BigNumber(process.env.AFRIPAY_FEE_RATE);
    const fixedFee = BigNumber(process.env.AFRIPAY_FIXED_FEE_USD);
    const feeAmount = baseAmount.multipliedBy(feeRate).plus(fixedFee);
    const totalAmount = baseAmount.plus(feeAmount);

    const paymentData = {
      user_id: paymentUrl.user_id,
      reference: paymentReference,
      amount: baseAmount.toNumber(),
      currency: paymentUrl.currency,
      status: 'pending',
      recipient_wallet: process.env.AFRIPAY_PLATFORM_WALLET,
      total_amount_paid: totalAmount.toNumber(),
      merchant_amount: baseAmount.toNumber(),
      fee_amount: feeAmount.toNumber(),
      description: `${paymentUrl.title} - Payment`,
      parent_reference: reference,
      created_at: new Date().toISOString()
    };

    const { data: payment } = await supabase
      .from('payments')
      .insert(paymentData)
      .select()
      .single();

    const recipientPublicKey = new PublicKey(process.env.AFRIPAY_PLATFORM_WALLET);
    const transaction = new Transaction();

    const bigAmount = BigNumber(totalAmount);

    if (paymentUrl.currency === 'USDC') {
      const buyerTokenAccount = await getAssociatedTokenAddress(USDC_MINT, buyerPublicKey);
      const recipientTokenAccount = await getAssociatedTokenAddress(USDC_MINT, recipientPublicKey);

      const usdcMint = await getMint(connection, USDC_MINT);

      const transferInstruction = createTransferCheckedInstruction(
        buyerTokenAccount,
        USDC_MINT,
        recipientTokenAccount,
        buyerPublicKey,
        bigAmount.multipliedBy(10 ** usdcMint.decimals).toNumber(),
        usdcMint.decimals
      );

      addReferenceToInstruction(transferInstruction, paymentReference);
      transaction.add(transferInstruction);

    } else {
      const SOL_PRICE_USD = await priceService.getSOLPrice();
      const solAmount = bigAmount.dividedBy(SOL_PRICE_USD);
      const lamports = solAmount.multipliedBy(LAMPORTS_PER_SOL).toNumber();

      const transferInstruction = SystemProgram.transfer({
        fromPubkey: buyerPublicKey,
        toPubkey: recipientPublicKey,
        lamports: Math.floor(lamports),
      });

      addReferenceToInstruction(transferInstruction, paymentReference);
      transaction.add(transferInstruction);
    }

    const { blockhash } = await connection.getLatestBlockhash('finalized');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = buyerPublicKey;

    const serializedTransaction = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    res.json({
      transaction: serializedTransaction.toString('base64'),
      message: paymentUrl.description || `Pay ${paymentUrl.amount} ${paymentUrl.currency}`,
      paymentReference
    });

  } catch (error) {
    console.error('Multi-transaction POST error:', error);
    res.status(500).json({ error: 'Failed to create transaction' });
  }
});
// try {
//   const { title, amount, currency, description, merchantId } = req.body;

//   if (!title || !amount || !currency || !merchantId) {
//     return res.status(400).json({ error: 'Missing required fields' });
//   }

//   const reference = randomUUID();
//   const paymentUrl = `solana:${process.env.BACKEND_URL}/api/solana-pay/transaction?reference=${reference}`;

//   const linkData = {
//     user_id: merchantId,
//     title,
//     reference,
//     amount: parseFloat(amount),
//     currency,
//     payment_url: paymentUrl,
//     description,
//     created_at: new Date().toISOString()
//   };

//   const { data: link, error } = await supabase
//     .from('payment_links')
//     .insert(linkData)
//     .select()
//     .single();

//   if (error) throw error;

//   res.json({
//     success: true,
//     link,
//     paymentUrl,
//     shareUrl: `${process.env.FRONTEND_URL}/pay/${reference}`
//   });

// } catch (error) {
//   console.error('Payment link creation error:', error);
//   res.status(500).json({ error: 'Failed to create payment link' });
// }
// });

// Generate QR code
app.get('/api/qr/:reference', async (req, res) => {
  try {
    const { reference } = req.params;
    const paymentUrl = `solana:${process.env.BACKEND_URL}/api/solana-pay/transaction?reference=${reference}`;

    const qrCode = await QRCode.toDataURL(paymentUrl);

    res.json({
      success: true,
      qrCode,
      paymentUrl
    });

  } catch (error) {
    console.error('QR code generation error:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// DATA & ANALYTICS

// Get dashboard analytics
app.get('/api/analytics/dashboard/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { period = '30d' } = req.query;

    const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);

    // Get payment statistics
    const { data: payments } = await supabase
      .from('payments')
      .select('amount, currency, status, created_at, fee_amount')
      .eq('user_id', userId)
      .gte('created_at', startDate.toISOString());

    const confirmedPayments = payments?.filter(p => p.status === 'confirmed') || [];

    const totalRevenue = confirmedPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const totalFees = confirmedPayments.reduce((sum, p) => sum + (p.fee_amount || 0), 0);
    const transactionCount = confirmedPayments.length;

    // Get balance (simplified - would need real wallet integration)
    const balance = {
      SOL: 0,
      USDC: 0
    };

    res.json({
      success: true,
      analytics: {
        totalRevenue,
        totalFees,
        transactionCount,
        balance,
        period,
        recentPayments: confirmedPayments.slice(-10)
      }
    });

  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

// Get transaction history
app.get('/api/transactions/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const offset = (page - 1) * limit;

    const { data: transactions, error } = await supabase
      .from('payments')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({
      success: true,
      transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: transactions.length === parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Transaction history error:', error);
    res.status(500).json({ error: 'Failed to get transaction history' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      database: 'connected',
      solana: 'connected',
      cctp: 'available'
    }
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'MVP Payment Server',
    version: '1.0.0',
    features: [
      'Payment Processing',
      'Solana Pay Integration',
      'CCTP Cross-Chain',
      'Invoicing & Payment Links',
      'QR Code Generation',
      'Analytics & Reporting'
    ],
    endpoints: {
      payments: '/api/payments',
      solanaPay: '/api/solana-pay/transaction',
      cctp: '/api/cctp/transfer',
      invoices: '/api/invoices',
      paymentLinks: '/api/payment-links',
      qr: '/api/qr/:reference',
      analytics: '/api/analytics/dashboard/:userId'
    }
  });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`🚀 MVP Payment Server running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`💳 Solana Pay: http://localhost:${PORT}/api/solana-pay/transaction`);
  console.log(`🔗 CCTP: http://localhost:${PORT}/api/cctp/transfer`);
});
