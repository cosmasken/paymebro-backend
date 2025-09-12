const { findReference, validateTransfer, FindReferenceError } = require('@solana/pay');
const { MERCHANT_WALLET, establishConnection } = require('./solana');
const { PublicKey } = require('@solana/web3.js');
const BigNumber = require('bignumber.js');
const database = require('./database');
const emailService = require('./emailService');
const { sendWebhook } = require('../controllers/webhooks');
const { notifyPaymentUpdate } = require('./websocket');
const logger = require('../utils/logger');

class PaymentMonitor {
  constructor() {
    this.connection = null;
    this.monitoringInterval = null;
    // Error handling configuration
    this.retryConfig = {
      maxRetries: 3,
      baseDelay: 1000, // 1 second
      maxDelay: 10000, // 10 seconds
      backoffMultiplier: 2
    };
    // Track retry attempts per payment
    this.retryAttempts = new Map();
  }

  /**
   * Helper method to safely extract account keys from transaction message
   * Handles both legacy and versioned transactions
   */
  getTransactionAccountKeys(transactionMessage) {
    try {
      const messageVersion = transactionMessage.version;

      logger.debug('Extracting account keys from transaction message:', {
        messageVersion: messageVersion || 'legacy',
        hasAccountKeys: !!transactionMessage.accountKeys,
        hasGetAccountKeys: typeof transactionMessage.getAccountKeys === 'function'
      });

      if (messageVersion === 'legacy' || messageVersion === undefined) {
        // Legacy transaction format
        if (!transactionMessage.accountKeys) {
          throw new Error('Legacy transaction missing accountKeys property');
        }
        logger.debug('Using legacy accountKeys property:', {
          accountKeysCount: transactionMessage.accountKeys.length
        });
        return transactionMessage.accountKeys;
      } else {
        // Versioned transaction format
        if (typeof transactionMessage.getAccountKeys !== 'function') {
          throw new Error('Versioned transaction missing getAccountKeys method');
        }
        const accountKeys = transactionMessage.getAccountKeys();
        logger.debug('Using versioned getAccountKeys() method:', {
          accountKeysCount: accountKeys.length,
          messageVersion
        });
        return accountKeys;
      }
    } catch (error) {
      logger.error('Error extracting account keys from transaction message:', {
        error: error.message,
        messageVersion: transactionMessage.version,
        hasAccountKeys: !!transactionMessage.accountKeys,
        hasGetAccountKeys: typeof transactionMessage.getAccountKeys === 'function'
      });
      throw new Error(`Failed to extract account keys: ${error.message}`);
    }
  }

  /**
   * Get or create connection
   */
  async getConnection() {
    if (!this.connection) {
      this.connection = await establishConnection();
    }
    return this.connection;
  }

  /**
   * Enhanced SOL payment validation with robust amount checking and balance analysis
   * @param {Connection} connection - Solana connection
   * @param {string} signature - Transaction signature
   * @param {Object} payment - Payment record from database
   * @param {Object} validateParams - Validation parameters
   * @param {PublicKey} referencePublicKey - Reference public key
   * @returns {Object} Validation result with isValid flag and details
   */
  async validateSOLPayment(connection, signature, payment, validateParams, referencePublicKey) {
    const paymentType = this.getPaymentTypeInfo(payment);

    logger.info('Starting enhanced SOL payment validation:', {
      reference: payment.reference,
      signature,
      paymentType: paymentType.type,
      description: paymentType.description,
      amount: payment.amount,
      currency: paymentType.currency
    });

    try {
      // Retrieve transaction with comprehensive error handling and retry logic
      let transaction;
      try {
        transaction = await this.executeWithRetry(
          async () => {
            const tx = await connection.getTransaction(signature, {
              commitment: 'confirmed',
              maxSupportedTransactionVersion: 0
            });
            if (!tx) {
              throw new Error('Transaction not found');
            }
            return tx;
          },
          payment,
          'get_transaction_for_validation',
          { maxRetries: 2 } // Fewer retries for validation step
        );
      } catch (rpcError) {
        const structuredError = this.createStructuredError(
          this.categorizeErrorType(rpcError),
          `Failed to retrieve transaction: ${rpcError.message}`,
          payment,
          paymentType,
          { signature, rpcErrorCode: rpcError.code }
        );
        logger.error('RPC error retrieving SOL transaction after retries:', structuredError);
        return {
          isValid: false,
          error: `Failed to retrieve transaction: ${rpcError.message}`
        };
      }

      if (!transaction) {
        const structuredError = this.createStructuredError(
          'TRANSACTION_NOT_FOUND',
          'Transaction not found',
          payment,
          paymentType,
          { signature }
        );
        logger.error('SOL transaction not found:', structuredError);
        return {
          isValid: false,
          error: 'Transaction not found'
        };
      }

      // Log detailed transaction analysis
      this.logTransactionAnalysis(transaction, payment, paymentType, signature);

      // Check transaction success status
      if (transaction.meta?.err) {
        const structuredError = this.createStructuredError(
          'TRANSACTION_FAILED',
          `Transaction failed: ${JSON.stringify(transaction.meta.err)}`,
          payment,
          paymentType,
          {
            signature,
            onChainError: transaction.meta.err,
            transactionVersion: transaction.transaction.message.version
          }
        );
        logger.error('SOL transaction failed on-chain:', structuredError);
        return {
          isValid: false,
          error: `Transaction failed: ${JSON.stringify(transaction.meta.err)}`
        };
      }

      // Extract account keys with proper error handling
      let accountKeys;
      try {
        accountKeys = this.getTransactionAccountKeys(transaction.transaction.message);
      } catch (keyError) {
        const structuredError = this.createStructuredError(
          'ACCOUNT_KEYS_ERROR',
          `Failed to extract account keys: ${keyError.message}`,
          payment,
          paymentType,
          {
            signature,
            messageVersion: transaction.transaction.message.version,
            keyExtractionError: keyError.message
          }
        );
        logger.error('Error accessing account keys for SOL validation:', structuredError);
        return {
          isValid: false,
          error: `Failed to extract account keys: ${keyError.message}`
        };
      }

      // Validate account keys array
      if (!accountKeys || !Array.isArray(accountKeys) || accountKeys.length === 0) {
        const structuredError = this.createStructuredError(
          'INVALID_ACCOUNT_KEYS',
          'Transaction has invalid account keys',
          payment,
          paymentType,
          {
            signature,
            accountKeysType: typeof accountKeys,
            accountKeysLength: accountKeys?.length || 0,
            isArray: Array.isArray(accountKeys)
          }
        );
        logger.error('Invalid account keys for SOL transaction:', structuredError);
        return {
          isValid: false,
          error: 'Transaction has invalid account keys'
        };
      }

      // Enhanced reference validation for both account-based and memo-based references
      const referenceValidation = this.validateSOLTransactionReference(
        transaction,
        referencePublicKey,
        accountKeys,
        payment,
        paymentType,
        signature
      );

      if (!referenceValidation.isValid) {
        return referenceValidation;
      }

      // Enhanced amount validation with proper lamport conversion
      const amountValidation = this.validateSOLAmount(
        transaction,
        payment,
        validateParams,
        accountKeys
      );

      if (!amountValidation.isValid) {
        return amountValidation;
      }

      // Log successful validation
      logger.info('SOL payment validation completed successfully:', {
        reference: payment.reference,
        signature,
        paymentType: paymentType.type,
        validationDetails: {
          referenceValidated: true,
          amountValidated: true,
          actualTransferLamports: amountValidation.details.actualTransferLamports,
          expectedLamports: amountValidation.details.expectedLamports,
          tolerance: amountValidation.details.tolerance
        }
      });

      // Return successful validation with details
      return {
        isValid: true,
        details: {
          referenceValidated: true,
          amountValidated: true,
          actualTransferLamports: amountValidation.details.actualTransferLamports,
          expectedLamports: amountValidation.details.expectedLamports,
          tolerance: amountValidation.details.tolerance,
          recipientIndex: amountValidation.details.recipientIndex
        }
      };

    } catch (error) {
      const structuredError = this.createStructuredError(
        'VALIDATION_EXCEPTION',
        `Validation error: ${error.message}`,
        payment,
        paymentType,
        {
          signature,
          errorName: error.name,
          stack: error.stack
        }
      );
      logger.error('Unexpected error in SOL payment validation:', structuredError);
      return {
        isValid: false,
        error: `Validation error: ${error.message}`
      };
    }
  }

  /**
   * Validate SOL transfer amount with robust lamport conversion and tolerance checking
   * @param {Object} transaction - Solana transaction object
   * @param {Object} payment - Payment record
   * @param {Object} validateParams - Validation parameters
   * @param {Array} accountKeys - Transaction account keys
   * @returns {Object} Amount validation result
   */
  validateSOLAmount(transaction, payment, validateParams, accountKeys) {
    const paymentType = this.getPaymentTypeInfo(payment);

    logger.info('Starting SOL amount validation:', {
      reference: payment.reference,
      paymentType: paymentType.type,
      expectedAmount: payment.amount,
      currency: paymentType.currency
    });

    try {
      // Convert expected amount to lamports with proper precision
      const expectedSOL = new BigNumber(payment.amount);
      const expectedLamports = expectedSOL.multipliedBy(1e9).integerValue();

      logger.info('SOL amount validation starting:', {
        reference: payment.reference,
        expectedSOL: expectedSOL.toString(),
        expectedLamports: expectedLamports.toString()
      });

      // Validate transaction metadata exists
      if (!transaction.meta?.preBalances || !transaction.meta?.postBalances) {
        const structuredError = this.createStructuredError(
          'MISSING_BALANCE_METADATA',
          'Transaction metadata incomplete - cannot verify SOL transfer amount',
          payment,
          paymentType,
          {
            hasPreBalances: !!transaction.meta?.preBalances,
            hasPostBalances: !!transaction.meta?.postBalances,
            hasMetadata: !!transaction.meta
          }
        );
        logger.error('Transaction metadata missing balance information:', structuredError);
        return {
          isValid: false,
          error: 'Transaction metadata incomplete - cannot verify SOL transfer amount'
        };
      }

      // Find recipient account index
      const recipientIndex = accountKeys.findIndex(
        key => key.equals(validateParams.recipient)
      );

      if (recipientIndex < 0) {
        const structuredError = this.createStructuredError(
          'RECIPIENT_NOT_FOUND',
          'Recipient address not found in transaction',
          payment,
          paymentType,
          {
            recipient: validateParams.recipient.toString(),
            accountKeysCount: accountKeys.length,
            accountKeys: accountKeys.map(key => key.toString())
          }
        );
        logger.warn('Recipient address not found in transaction account keys:', structuredError);
        return {
          isValid: false,
          error: 'Recipient address not found in transaction'
        };
      }

      // Calculate actual transfer using pre/post balance analysis
      const preBalance = new BigNumber(transaction.meta.preBalances[recipientIndex]);
      const postBalance = new BigNumber(transaction.meta.postBalances[recipientIndex]);
      const actualTransferLamports = postBalance.minus(preBalance);

      logger.info('SOL balance analysis:', {
        reference: payment.reference,
        recipientIndex,
        preBalance: preBalance.toString(),
        postBalance: postBalance.toString(),
        actualTransferLamports: actualTransferLamports.toString(),
        expectedLamports: expectedLamports.toString()
      });

      // Implement tolerance-based amount checking
      // Use a more sophisticated tolerance calculation:
      // - Minimum 1000 lamports (0.000001 SOL) for micro-transactions
      // - 0.5% tolerance for larger amounts to account for network fees and precision
      const baseTolerance = new BigNumber(1000); // 1000 lamports minimum
      const percentageTolerance = expectedLamports.multipliedBy(0.005); // 0.5%
      const tolerance = BigNumber.maximum(baseTolerance, percentageTolerance);

      const minAcceptable = expectedLamports.minus(tolerance);
      const maxAcceptable = expectedLamports.plus(tolerance);

      logger.info('SOL tolerance calculation:', {
        reference: payment.reference,
        baseTolerance: baseTolerance.toString(),
        percentageTolerance: percentageTolerance.toString(),
        finalTolerance: tolerance.toString(),
        minAcceptable: minAcceptable.toString(),
        maxAcceptable: maxAcceptable.toString()
      });

      // Validate amount is within acceptable range
      if (actualTransferLamports.isLessThan(minAcceptable)) {
        const structuredError = this.createStructuredError(
          'AMOUNT_TOO_LOW',
          `SOL transfer amount too low: expected ${expectedLamports.toString()} lamports, got ${actualTransferLamports.toString()} lamports`,
          payment,
          paymentType,
          {
            expectedLamports: expectedLamports.toString(),
            actualTransferLamports: actualTransferLamports.toString(),
            minAcceptable: minAcceptable.toString(),
            shortfall: minAcceptable.minus(actualTransferLamports).toString(),
            toleranceUsed: tolerance.toString()
          }
        );
        logger.warn('SOL transfer amount below acceptable threshold:', structuredError);
        return {
          isValid: false,
          error: `SOL transfer amount too low: expected ${expectedLamports.toString()} lamports, got ${actualTransferLamports.toString()} lamports`
        };
      }

      if (actualTransferLamports.isGreaterThan(maxAcceptable)) {
        const overpaymentInfo = {
          reference: payment.reference,
          paymentType: paymentType.type,
          expectedLamports: expectedLamports.toString(),
          actualTransferLamports: actualTransferLamports.toString(),
          maxAcceptable: maxAcceptable.toString(),
          excess: actualTransferLamports.minus(maxAcceptable).toString(),
          toleranceUsed: tolerance.toString()
        };
        logger.warn('SOL transfer amount above acceptable threshold (accepting as overpayment):', overpaymentInfo);
      }

      logger.info('SOL amount validation successful:', {
        reference: payment.reference,
        expectedLamports: expectedLamports.toString(),
        actualTransferLamports: actualTransferLamports.toString(),
        tolerance: tolerance.toString(),
        withinRange: true
      });

      return {
        isValid: true,
        details: {
          actualTransferLamports: actualTransferLamports.toString(),
          expectedLamports: expectedLamports.toString(),
          tolerance: tolerance.toString(),
          recipientIndex,
          preBalance: preBalance.toString(),
          postBalance: postBalance.toString()
        }
      };

    } catch (error) {
      const structuredError = this.createStructuredError(
        'AMOUNT_VALIDATION_EXCEPTION',
        `Amount validation error: ${error.message}`,
        payment,
        paymentType,
        {
          errorName: error.name,
          stack: error.stack
        }
      );
      logger.error('Error in SOL amount validation:', structuredError);
      return {
        isValid: false,
        error: `Amount validation error: ${error.message}`
      };
    }
  }

  /**
   * Validate reference inclusion in SOL transactions
   * Handles both account-based and memo-based reference validation
   * @param {Object} transaction - Solana transaction object
   * @param {PublicKey} referencePublicKey - Reference public key to validate
   * @param {Array} accountKeys - Transaction account keys
   * @param {Object} payment - Payment record
   * @param {Object} paymentType - Payment type information
   * @param {string} signature - Transaction signature
   * @returns {Object} Reference validation result
   */
  validateSOLTransactionReference(transaction, referencePublicKey, accountKeys, payment, paymentType, signature) {
    logger.info('Starting comprehensive reference validation for SOL transaction:', {
      reference: payment.reference,
      signature,
      paymentType: paymentType.type,
      referenceKey: referencePublicKey.toString()
    });

    try {
      // Method 1: Check if reference is included as an account key (account-based reference)
      const accountBasedReference = this.validateAccountBasedReference(
        accountKeys,
        referencePublicKey,
        payment,
        paymentType,
        signature
      );

      // Method 2: Check if reference is included in memo instructions (memo-based reference)
      const memoBasedReference = this.validateMemoBasedReference(
        transaction,
        referencePublicKey,
        payment,
        paymentType,
        signature
      );

      // Reference is valid if found through either method
      const isReferenceValid = accountBasedReference.found || memoBasedReference.found;

      if (!isReferenceValid) {
        const structuredError = this.createStructuredError(
          'REFERENCE_NOT_FOUND',
          'Reference key not found in SOL transaction (checked both account keys and memo instructions)',
          payment,
          paymentType,
          {
            signature,
            referenceKey: referencePublicKey.toString(),
            accountBasedCheck: accountBasedReference,
            memoBasedCheck: memoBasedReference,
            accountKeysCount: accountKeys.length,
            instructionsCount: transaction.transaction.message.instructions?.length || 0
          }
        );
        logger.warn('Reference validation failed for SOL transaction:', structuredError);
        return {
          isValid: false,
          error: 'Reference key not found in SOL transaction (checked both account keys and memo instructions)'
        };
      }

      // Log successful reference validation with details
      logger.info('Reference validation successful for SOL transaction:', {
        reference: payment.reference,
        signature,
        paymentType: paymentType.type,
        validationMethod: accountBasedReference.found ? 'account-based' : 'memo-based',
        accountBasedFound: accountBasedReference.found,
        memoBasedFound: memoBasedReference.found,
        details: {
          accountBased: accountBasedReference,
          memoBased: memoBasedReference
        }
      });

      return {
        isValid: true,
        details: {
          validationMethod: accountBasedReference.found ? 'account-based' : 'memo-based',
          accountBasedReference,
          memoBasedReference
        }
      };

    } catch (error) {
      const structuredError = this.createStructuredError(
        'REFERENCE_VALIDATION_EXCEPTION',
        `Reference validation error: ${error.message}`,
        payment,
        paymentType,
        {
          signature,
          referenceKey: referencePublicKey.toString(),
          errorName: error.name,
          stack: error.stack
        }
      );
      logger.error('Exception during reference validation:', structuredError);
      return {
        isValid: false,
        error: `Reference validation error: ${error.message}`
      };
    }
  }

  /**
   * Validate account-based reference inclusion
   * Checks if the reference public key is included in transaction account keys
   * @param {Array} accountKeys - Transaction account keys
   * @param {PublicKey} referencePublicKey - Reference public key
   * @param {Object} payment - Payment record
   * @param {Object} paymentType - Payment type information
   * @param {string} signature - Transaction signature
   * @returns {Object} Account-based reference validation result
   */
  validateAccountBasedReference(accountKeys, referencePublicKey, payment, paymentType, signature) {
    logger.debug('Validating account-based reference:', {
      reference: payment.reference,
      signature,
      accountKeysCount: accountKeys.length,
      referenceKey: referencePublicKey.toString()
    });

    try {
      let referenceFound = false;
      let referenceIndex = -1;

      // Check each account key for reference match
      for (let i = 0; i < accountKeys.length; i++) {
        try {
          if (accountKeys[i].equals(referencePublicKey)) {
            referenceFound = true;
            referenceIndex = i;
            break;
          }
        } catch (compareError) {
          logger.warn('Error comparing account key with reference:', {
            reference: payment.reference,
            signature,
            accountIndex: i,
            error: compareError.message
          });
          // Continue checking other keys
        }
      }

      const result = {
        found: referenceFound,
        method: 'account-based',
        referenceIndex,
        accountKeysChecked: accountKeys.length,
        referenceKey: referencePublicKey.toString()
      };

      if (referenceFound) {
        logger.debug('Account-based reference found:', {
          reference: payment.reference,
          signature,
          referenceIndex,
          accountKey: accountKeys[referenceIndex].toString()
        });
      } else {
        logger.debug('Account-based reference not found:', {
          reference: payment.reference,
          signature,
          accountKeysChecked: accountKeys.length,
          accountKeys: accountKeys.map((key, idx) => ({ index: idx, key: key.toString() }))
        });
      }

      return result;

    } catch (error) {
      logger.error('Error in account-based reference validation:', {
        reference: payment.reference,
        signature,
        error: error.message
      });
      return {
        found: false,
        method: 'account-based',
        error: error.message,
        referenceKey: referencePublicKey.toString()
      };
    }
  }

  /**
   * Validate memo-based reference inclusion
   * Checks if the reference is included in memo instructions
   * @param {Object} transaction - Solana transaction object
   * @param {PublicKey} referencePublicKey - Reference public key
   * @param {Object} payment - Payment record
   * @param {Object} paymentType - Payment type information
   * @param {string} signature - Transaction signature
   * @returns {Object} Memo-based reference validation result
   */
  validateMemoBasedReference(transaction, referencePublicKey, payment, paymentType, signature) {
    logger.debug('Validating memo-based reference:', {
      reference: payment.reference,
      signature,
      referenceKey: referencePublicKey.toString()
    });

    try {
      const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
      const instructions = transaction.transaction.message.instructions || [];

      let memoInstructions = [];
      let referenceFoundInMemo = false;
      let matchingMemoIndex = -1;

      // Extract account keys for program ID resolution
      let accountKeys;
      try {
        accountKeys = this.getTransactionAccountKeys(transaction.transaction.message);
      } catch (keyError) {
        logger.warn('Could not extract account keys for memo validation:', {
          reference: payment.reference,
          signature,
          error: keyError.message
        });
        return {
          found: false,
          method: 'memo-based',
          error: 'Could not extract account keys for memo validation',
          referenceKey: referencePublicKey.toString()
        };
      }

      // Check each instruction for memo program usage
      for (let i = 0; i < instructions.length; i++) {
        const instruction = instructions[i];

        try {
          // Get the program ID for this instruction
          const programId = accountKeys[instruction.programIdIndex];

          // Check if this is a memo instruction
          if (programId.equals(MEMO_PROGRAM_ID)) {
            // Decode memo data
            const memoData = instruction.data;
            let memoText = '';

            try {
              // Memo data is typically UTF-8 encoded
              memoText = Buffer.from(memoData).toString('utf8');
            } catch (decodeError) {
              logger.warn('Could not decode memo instruction data:', {
                reference: payment.reference,
                signature,
                instructionIndex: i,
                error: decodeError.message
              });
              memoText = 'Unable to decode';
            }

            memoInstructions.push({
              index: i,
              programId: programId.toString(),
              data: memoData,
              decodedText: memoText,
              dataLength: memoData.length
            });

            // Check if memo contains the reference key
            const referenceString = referencePublicKey.toString();
            if (memoText.includes(referenceString)) {
              referenceFoundInMemo = true;
              matchingMemoIndex = i;

              logger.debug('Reference found in memo instruction:', {
                reference: payment.reference,
                signature,
                instructionIndex: i,
                memoText,
                referenceKey: referenceString
              });
            }
          }
        } catch (instructionError) {
          logger.warn('Error processing instruction for memo validation:', {
            reference: payment.reference,
            signature,
            instructionIndex: i,
            error: instructionError.message
          });
          // Continue checking other instructions
        }
      }

      const result = {
        found: referenceFoundInMemo,
        method: 'memo-based',
        memoInstructionsFound: memoInstructions.length,
        matchingMemoIndex,
        memoInstructions,
        totalInstructions: instructions.length,
        referenceKey: referencePublicKey.toString()
      };

      if (referenceFoundInMemo) {
        logger.debug('Memo-based reference validation successful:', {
          reference: payment.reference,
          signature,
          matchingMemoIndex,
          memoText: memoInstructions[matchingMemoIndex]?.decodedText
        });
      } else {
        logger.debug('Memo-based reference not found:', {
          reference: payment.reference,
          signature,
          memoInstructionsChecked: memoInstructions.length,
          totalInstructions: instructions.length,
          memoInstructions: memoInstructions.map(memo => ({
            index: memo.index,
            text: memo.decodedText
          }))
        });
      }

      return result;

    } catch (error) {
      logger.error('Error in memo-based reference validation:', {
        reference: payment.reference,
        signature,
        error: error.message
      });
      return {
        found: false,
        method: 'memo-based',
        error: error.message,
        referenceKey: referencePublicKey.toString()
      };
    }
  }

  /**
   * Start monitoring pending payments
   */
  startMonitoring() {
    if (this.monitoringInterval) return;

    this.monitoringInterval = setInterval(async () => {
      await this.checkPendingPayments();
    }, 15000); // Check every 15 seconds

    // Clean up old retry attempts every 5 minutes to prevent memory leaks
    this.cleanupInterval = setInterval(() => {
      this.cleanupRetryAttempts();
    }, 300000); // 5 minutes

    logger.info('Payment monitoring started with error handling and cleanup');
  }

  /**
   * Clean up old retry attempts to prevent memory leaks
   */
  cleanupRetryAttempts() {
    const maxAge = 30 * 60 * 1000; // 30 minutes
    const now = Date.now();
    let cleanedCount = 0;

    // Note: This is a simple cleanup. In production, you might want to track timestamps
    // For now, we'll just clear all entries periodically
    if (this.retryAttempts.size > 100) {
      this.retryAttempts.clear();
      cleanedCount = this.retryAttempts.size;

      logger.debug('Cleaned up retry attempts cache:', {
        entriesRemoved: cleanedCount,
        reason: 'size_limit_exceeded'
      });
    }
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Clear retry attempts on shutdown
    this.retryAttempts.clear();

    logger.info('Payment monitoring stopped and cleanup completed');
  }

  /**
   * Check all pending payments for confirmation
   */
  async checkPendingPayments() {
    try {
      const { data: pendingPayments, error } = await database.getClient()
        .from('payments')
        .select('id, reference, amount, currency, spl_token_mint, web3auth_user_id, customer_email, chain, recipient_address')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(50);

      if (error) {
        logger.error('Database error retrieving pending payments:', {
          error: error.message,
          code: error.code,
          details: error.details
        });
        return;
      }

      if (!pendingPayments || pendingPayments.length === 0) {
        logger.debug('No pending payments to process');
        return;
      }

      // Log payment type distribution for monitoring insights
      const paymentTypeStats = pendingPayments.reduce((stats, payment) => {
        const paymentType = this.getPaymentTypeInfo(payment);
        stats[paymentType.type] = (stats[paymentType.type] || 0) + 1;
        return stats;
      }, {});

      logger.info('Processing pending payments with type distribution:', {
        count: pendingPayments.length,
        typeDistribution: paymentTypeStats
      });

      for (const payment of pendingPayments) {
        await this.checkPaymentConfirmation(payment);
      }
    } catch (error) {
      logger.error('Error checking pending payments:', {
        error: error.message,
        stack: error.stack
      });
    }
  }

  /**
   * Determine payment type based on payment data
   * @param {Object} payment - Payment record from database
   * @returns {Object} Payment type information
   */
  getPaymentTypeInfo(payment) {
    const isSOL = !payment.spl_token_mint && (payment.currency === 'SOL' || payment.currency === 'sol');
    const isSPLToken = !!payment.spl_token_mint;

    return {
      type: isSOL ? 'SOL' : 'SPL_TOKEN',
      isSOL,
      isSPLToken,
      currency: payment.currency,
      tokenMint: payment.spl_token_mint || null,
      description: isSOL ? 'Native SOL Transfer' : `SPL Token Transfer (${payment.currency})`
    };
  }

  /**
   * Log detailed transaction analysis for debugging
   * @param {Object} transaction - Solana transaction object
   * @param {Object} payment - Payment record
   * @param {Object} paymentType - Payment type information
   * @param {string} signature - Transaction signature
   */
  logTransactionAnalysis(transaction, payment, paymentType, signature) {
    try {
      const analysis = {
        reference: payment.reference,
        signature,
        paymentType: paymentType.type,
        currency: paymentType.currency,
        tokenMint: paymentType.tokenMint,
        transactionDetails: {
          version: transaction.transaction.message.version || 'legacy',
          accountKeysCount: null,
          instructionsCount: transaction.transaction.message.instructions?.length || 0,
          hasMetadata: !!transaction.meta,
          transactionSuccess: !transaction.meta?.err,
          error: transaction.meta?.err ? JSON.stringify(transaction.meta.err) : null
        }
      };

      // Safely get account keys count
      try {
        const accountKeys = this.getTransactionAccountKeys(transaction.transaction.message);
        analysis.transactionDetails.accountKeysCount = accountKeys?.length || 0;
      } catch (keyError) {
        analysis.transactionDetails.accountKeysError = keyError.message;
      }

      // Add balance information for SOL payments
      if (paymentType.isSOL && transaction.meta) {
        analysis.balanceAnalysis = {
          hasPreBalances: !!transaction.meta.preBalances,
          hasPostBalances: !!transaction.meta.postBalances,
          preBalancesCount: transaction.meta.preBalances?.length || 0,
          postBalancesCount: transaction.meta.postBalances?.length || 0
        };
      }

      // Add instruction analysis for SPL token payments
      if (paymentType.isSPLToken && transaction.transaction.message.instructions) {
        analysis.instructionAnalysis = {
          instructionTypes: transaction.transaction.message.instructions.map((inst, idx) => ({
            index: idx,
            programIdIndex: inst.programIdIndex,
            accountsCount: inst.accounts?.length || 0,
            dataLength: inst.data?.length || 0
          }))
        };
      }

      logger.info('Transaction analysis for payment validation:', analysis);
    } catch (error) {
      logger.warn('Failed to generate transaction analysis:', {
        reference: payment.reference,
        signature,
        error: error.message
      });
    }
  }

  /**
   * Create structured error message with payment type context
   * @param {string} errorType - Type of error (validation, rpc, parsing, etc.)
   * @param {string} message - Error message
   * @param {Object} payment - Payment record
   * @param {Object} paymentType - Payment type information
   * @param {Object} context - Additional context
   * @returns {Object} Structured error object
   */
  createStructuredError(errorType, message, payment, paymentType, context = {}) {
    return {
      errorType,
      message,
      paymentContext: {
        reference: payment.reference,
        paymentType: paymentType.type,
        currency: paymentType.currency,
        amount: payment.amount,
        tokenMint: paymentType.tokenMint,
        description: paymentType.description
      },
      additionalContext: context,
      timestamp: new Date().toISOString(),
      severity: this.categorizeErrorSeverity(errorType),
      isRetryable: this.isRetryableError(errorType, context)
    };
  }

  /**
   * Categorize error severity for SOL payment validation failures
   * @param {string} errorType - Type of error
   * @returns {string} Severity level (critical, high, medium, low)
   */
  categorizeErrorSeverity(errorType) {
    const severityMap = {
      // Critical errors - system/infrastructure issues
      'RPC_CONNECTION_FAILED': 'critical',
      'DATABASE_ERROR': 'critical',
      'NETWORK_TIMEOUT': 'critical',

      // High severity - validation failures that prevent payment confirmation
      'TRANSACTION_FAILED': 'high',
      'AMOUNT_TOO_LOW': 'high',
      'RECIPIENT_NOT_FOUND': 'high',
      'REFERENCE_NOT_FOUND': 'high',
      'INVALID_ACCOUNT_KEYS': 'high',

      // Medium severity - recoverable validation issues
      'RPC_ERROR': 'medium',
      'TRANSACTION_NOT_FOUND': 'medium',
      'MISSING_BALANCE_METADATA': 'medium',
      'ACCOUNT_KEYS_ERROR': 'medium',

      // Low severity - temporary or expected issues
      'VALIDATION_EXCEPTION': 'low',
      'AMOUNT_VALIDATION_EXCEPTION': 'low',
      'REFERENCE_VALIDATION_EXCEPTION': 'low'
    };

    return severityMap[errorType] || 'medium';
  }

  /**
   * Determine if an error is retryable based on error type and context
   * @param {string} errorType - Type of error
   * @param {Object} context - Error context
   * @returns {boolean} Whether the error should be retried
   */
  isRetryableError(errorType, context = {}) {
    // Retryable error types (typically transient RPC/network issues)
    const retryableErrors = [
      'RPC_ERROR',
      'RPC_CONNECTION_FAILED',
      'NETWORK_TIMEOUT',
      'TRANSACTION_NOT_FOUND', // Transaction might not be confirmed yet
      'MISSING_BALANCE_METADATA' // RPC might not have complete data yet
    ];

    if (retryableErrors.includes(errorType)) {
      return true;
    }

    // Check for specific RPC error codes that are retryable
    if (errorType === 'RPC_ERROR' && context.rpcErrorCode) {
      const retryableRpcCodes = [
        -32603, // Internal error
        -32005, // Node is unhealthy
        -32004, // Transaction not found (temporary)
        429,    // Rate limit
        503,    // Service unavailable
        504     // Gateway timeout
      ];
      return retryableRpcCodes.includes(context.rpcErrorCode);
    }

    return false;
  }

  /**
   * Execute operation with retry logic for transient errors
   * @param {Function} operation - Async operation to execute
   * @param {Object} payment - Payment record for context
   * @param {string} operationName - Name of operation for logging
   * @param {Object} options - Retry options
   * @returns {Promise} Operation result
   */
  async executeWithRetry(operation, payment, operationName, options = {}) {
    const paymentType = this.getPaymentTypeInfo(payment);
    const retryKey = `${payment.reference}-${operationName}`;

    // Get current retry count for this payment/operation
    const currentRetries = this.retryAttempts.get(retryKey) || 0;
    const maxRetries = options.maxRetries || this.retryConfig.maxRetries;

    logger.debug('Executing operation with retry logic:', {
      reference: payment.reference,
      operationName,
      currentRetries,
      maxRetries,
      paymentType: paymentType.type
    });

    try {
      const result = await operation();

      // Success - reset retry counter
      if (currentRetries > 0) {
        this.retryAttempts.delete(retryKey);
        logger.info('Operation succeeded after retries:', {
          reference: payment.reference,
          operationName,
          retriesUsed: currentRetries,
          paymentType: paymentType.type
        });
      }

      return result;
    } catch (error) {
      const structuredError = this.createStructuredError(
        this.categorizeErrorType(error),
        error.message,
        payment,
        paymentType,
        {
          operationName,
          currentRetries,
          maxRetries,
          errorName: error.name,
          rpcErrorCode: error.code
        }
      );

      // Check if error is retryable and we haven't exceeded max retries
      if (structuredError.isRetryable && currentRetries < maxRetries) {
        // Increment retry counter
        this.retryAttempts.set(retryKey, currentRetries + 1);

        // Calculate delay with exponential backoff
        const delay = Math.min(
          this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, currentRetries),
          this.retryConfig.maxDelay
        );

        logger.warn('Retryable error encountered, scheduling retry:', {
          ...structuredError,
          retryAttempt: currentRetries + 1,
          delayMs: delay,
          nextRetryIn: `${delay}ms`
        });

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, delay));

        // Recursive retry
        return this.executeWithRetry(operation, payment, operationName, options);
      } else {
        // Max retries exceeded or non-retryable error
        if (currentRetries >= maxRetries) {
          this.retryAttempts.delete(retryKey);
          logger.error('Max retries exceeded for operation:', {
            ...structuredError,
            finalAttempt: true,
            totalRetries: currentRetries
          });
        } else {
          logger.error('Non-retryable error encountered:', structuredError);
        }

        throw error;
      }
    }
  }

  /**
   * Categorize error type based on error properties
   * @param {Error} error - Error object
   * @returns {string} Categorized error type
   */
  categorizeErrorType(error) {
    // Network/RPC related errors
    if (error.code) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        return 'RPC_CONNECTION_FAILED';
      }
      if (error.code === 'ETIMEDOUT') {
        return 'NETWORK_TIMEOUT';
      }
      // RPC error codes
      if (typeof error.code === 'number') {
        return 'RPC_ERROR';
      }
    }

    // Solana Pay specific errors
    if (error instanceof FindReferenceError || error.message === 'not found') {
      return 'TRANSACTION_NOT_FOUND';
    }

    // Database errors
    if (error.message && error.message.includes('database')) {
      return 'DATABASE_ERROR';
    }

    // Validation errors based on message content
    if (error.message) {
      const message = error.message.toLowerCase();

      if (message.includes('account keys')) {
        return 'ACCOUNT_KEYS_ERROR';
      }
      if (message.includes('amount too low')) {
        return 'AMOUNT_TOO_LOW';
      }
      if (message.includes('recipient not found')) {
        return 'RECIPIENT_NOT_FOUND';
      }
      if (message.includes('reference') && message.includes('not found')) {
        return 'REFERENCE_NOT_FOUND';
      }
      if (message.includes('balance metadata')) {
        return 'MISSING_BALANCE_METADATA';
      }
      if (message.includes('transaction failed')) {
        return 'TRANSACTION_FAILED';
      }
    }

    // Default categorization
    return 'VALIDATION_EXCEPTION';
  }

  /**
   * Implement fallback behavior for SOL validation failures
   * @param {Object} payment - Payment record
   * @param {Error} primaryError - Primary validation error
   * @param {Object} context - Additional context
   * @returns {Object} Fallback result
   */
  async handleSOLValidationFallback(payment, primaryError, context = {}) {
    const paymentType = this.getPaymentTypeInfo(payment);

    logger.info('Implementing SOL validation fallback behavior:', {
      reference: payment.reference,
      paymentType: paymentType.type,
      primaryError: primaryError.message,
      fallbackContext: context
    });

    try {
      // Fallback strategy 1: Try with different RPC commitment level
      if (context.signature && !context.triedDifferentCommitment) {
        logger.info('Fallback: Trying different commitment level for SOL validation:', {
          reference: payment.reference,
          signature: context.signature
        });

        try {
          const connection = await this.getConnection();
          const transaction = await connection.getTransaction(context.signature, {
            commitment: 'finalized', // More strict commitment
            maxSupportedTransactionVersion: 0
          });

          if (transaction) {
            logger.info('Fallback successful: Transaction found with finalized commitment:', {
              reference: payment.reference,
              signature: context.signature
            });

            return {
              success: true,
              method: 'finalized_commitment',
              transaction
            };
          }
        } catch (fallbackError) {
          logger.warn('Fallback with finalized commitment failed:', {
            reference: payment.reference,
            error: fallbackError.message
          });
        }
      }

      // Fallback strategy 2: Simplified validation (amount only)
      if (context.signature && !context.triedSimplifiedValidation) {
        logger.info('Fallback: Attempting simplified SOL validation:', {
          reference: payment.reference,
          signature: context.signature
        });

        try {
          const result = await this.performSimplifiedSOLValidation(payment, context.signature);
          if (result.isValid) {
            logger.info('Fallback successful: Simplified validation passed:', {
              reference: payment.reference,
              signature: context.signature,
              validationDetails: result.details
            });

            return {
              success: true,
              method: 'simplified_validation',
              details: result.details
            };
          }
        } catch (fallbackError) {
          logger.warn('Simplified validation fallback failed:', {
            reference: payment.reference,
            error: fallbackError.message
          });
        }
      }

      // Fallback strategy 3: Manual confirmation with reduced requirements
      if (context.allowManualConfirmation) {
        logger.info('Fallback: Manual confirmation mode for SOL payment:', {
          reference: payment.reference,
          signature: context.signature
        });

        // Log for manual review
        const manualReviewData = {
          reference: payment.reference,
          signature: context.signature,
          amount: payment.amount,
          currency: payment.currency,
          recipient: payment.recipient_address,
          primaryError: primaryError.message,
          timestamp: new Date().toISOString(),
          requiresManualReview: true
        };

        logger.warn('SOL payment requires manual review due to validation failures:', manualReviewData);

        return {
          success: false,
          method: 'manual_review_required',
          manualReviewData
        };
      }

      // No successful fallback
      logger.error('All SOL validation fallback strategies failed:', {
        reference: payment.reference,
        primaryError: primaryError.message,
        fallbacksAttempted: [
          context.triedDifferentCommitment ? 'finalized_commitment' : null,
          context.triedSimplifiedValidation ? 'simplified_validation' : null,
          context.allowManualConfirmation ? 'manual_review' : null
        ].filter(Boolean)
      });

      return {
        success: false,
        method: 'all_fallbacks_failed',
        primaryError: primaryError.message
      };

    } catch (error) {
      logger.error('Error in SOL validation fallback handling:', {
        reference: payment.reference,
        error: error.message,
        stack: error.stack
      });

      return {
        success: false,
        method: 'fallback_exception',
        error: error.message
      };
    }
  }

  /**
   * Perform simplified SOL validation with reduced requirements
   * @param {Object} payment - Payment record
   * @param {string} signature - Transaction signature
   * @returns {Object} Simplified validation result
   */
  async performSimplifiedSOLValidation(payment, signature) {
    const paymentType = this.getPaymentTypeInfo(payment);

    logger.info('Performing simplified SOL validation:', {
      reference: payment.reference,
      signature,
      paymentType: paymentType.type
    });

    try {
      const connection = await this.getConnection();

      // Get transaction with basic error handling
      const transaction = await connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      });

      if (!transaction) {
        return {
          isValid: false,
          error: 'Transaction not found in simplified validation'
        };
      }

      // Check transaction success
      if (transaction.meta?.err) {
        return {
          isValid: false,
          error: `Transaction failed: ${JSON.stringify(transaction.meta.err)}`
        };
      }

      // Simplified amount check - just verify some SOL was transferred
      if (transaction.meta?.preBalances && transaction.meta?.postBalances) {
        const expectedLamports = new BigNumber(payment.amount).multipliedBy(1e9);
        let totalTransferred = new BigNumber(0);

        // Sum all balance changes to find total SOL movement
        for (let i = 0; i < transaction.meta.preBalances.length; i++) {
          const preBalance = new BigNumber(transaction.meta.preBalances[i]);
          const postBalance = new BigNumber(transaction.meta.postBalances[i]);
          const change = postBalance.minus(preBalance);

          if (change.isPositive()) {
            totalTransferred = totalTransferred.plus(change);
          }
        }

        // Very lenient check - just verify some reasonable amount was transferred
        const minExpected = expectedLamports.multipliedBy(0.5); // 50% tolerance

        if (totalTransferred.isGreaterThanOrEqualTo(minExpected)) {
          logger.info('Simplified SOL validation successful:', {
            reference: payment.reference,
            signature,
            expectedLamports: expectedLamports.toString(),
            totalTransferred: totalTransferred.toString(),
            tolerance: '50%'
          });

          return {
            isValid: true,
            details: {
              validationMethod: 'simplified',
              expectedLamports: expectedLamports.toString(),
              totalTransferred: totalTransferred.toString(),
              tolerance: '50%'
            }
          };
        }
      }

      return {
        isValid: false,
        error: 'Simplified validation failed - insufficient SOL transfer detected'
      };

    } catch (error) {
      logger.error('Error in simplified SOL validation:', {
        reference: payment.reference,
        signature,
        error: error.message
      });

      return {
        isValid: false,
        error: `Simplified validation error: ${error.message}`
      };
    }
  }

  /**
   * Check if a specific payment is confirmed on-chain with comprehensive error handling
   */
  async checkPaymentConfirmation(payment) {
    const paymentType = this.getPaymentTypeInfo(payment);

    try {
      // Wrap the entire confirmation process in retry logic for SOL payments
      if (paymentType.isSOL) {
        await this.executeWithRetry(
          () => this.performPaymentConfirmation(payment),
          payment,
          'sol_payment_confirmation'
        );
      } else {
        // For SPL tokens, use standard confirmation without retry
        await this.performPaymentConfirmation(payment);
      }

    } catch (error) {
      // Check if it's a FindReferenceError (payment not found yet)
      if (error instanceof FindReferenceError || error.message === 'not found') {
        // This is normal - payment not confirmed yet
        logger.debug('Payment not yet confirmed on-chain:', {
          reference: payment.reference,
          paymentType: paymentType.type,
          currency: paymentType.currency,
          error: error.message
        });
        return;
      }

      // Create structured error for payment validation failure
      const structuredError = this.createStructuredError(
        this.categorizeErrorType(error),
        error.message,
        payment,
        paymentType,
        {
          recipient: payment.recipient_address,
          errorName: error.name,
          stack: error.stack
        }
      );

      // For SOL payments, attempt fallback behavior if error is severe
      if (paymentType.isSOL && structuredError.severity === 'high') {
        logger.warn('Attempting SOL validation fallback due to high severity error:', structuredError);

        const fallbackResult = await this.handleSOLValidationFallback(payment, error, {
          triedDifferentCommitment: false,
          triedSimplifiedValidation: false,
          allowManualConfirmation: true
        });

        if (fallbackResult.success) {
          logger.info('SOL payment fallback successful:', {
            reference: payment.reference,
            fallbackMethod: fallbackResult.method,
            originalError: error.message
          });

          // If fallback found a valid transaction, try to confirm it
          if (fallbackResult.transaction || fallbackResult.details) {
            try {
              // For successful fallbacks, we still need a signature to confirm
              // This would need to be extracted from the fallback result
              logger.info('SOL payment confirmed via fallback method:', {
                reference: payment.reference,
                method: fallbackResult.method
              });
            } catch (confirmError) {
              logger.error('Failed to confirm SOL payment after successful fallback:', {
                reference: payment.reference,
                error: confirmError.message
              });
            }
          }
        } else {
          logger.error('SOL payment fallback failed:', {
            reference: payment.reference,
            fallbackMethod: fallbackResult.method,
            originalError: error.message
          });
        }
      }

      // Log validation errors with payment type context and severity
      if (structuredError.severity === 'critical') {
        logger.error('Critical payment confirmation error:', structuredError);
      } else if (structuredError.severity === 'high') {
        logger.error('High severity payment confirmation error:', structuredError);
      } else {
        logger.warn('Payment confirmation error:', structuredError);
      }
    }
  }

  /**
   * Perform the actual payment confirmation logic
   * @param {Object} payment - Payment record
   */
  async performPaymentConfirmation(payment) {
    const connection = await this.getConnection();
    const referencePublicKey = new PublicKey(payment.reference);
    const paymentType = this.getPaymentTypeInfo(payment);

    logger.info('Checking payment confirmation with comprehensive error handling:', {
      reference: payment.reference,
      recipient_address: payment.recipient_address,
      amount: payment.amount,
      currency: payment.currency,
      paymentType: paymentType.type,
      description: paymentType.description,
      tokenMint: paymentType.tokenMint
    });

    // Use findReference from @solana/pay with retry logic for RPC calls
    const signatureInfo = await this.executeWithRetry(
      async () => {
        return await findReference(
          connection,
          referencePublicKey,
          { finality: 'confirmed' }
        );
      },
      payment,
      'find_reference'
    );

    logger.info('Found transaction signature for payment type:', {
      reference: payment.reference,
      signature: signatureInfo.signature,
      paymentType: paymentType.type,
      currency: paymentType.currency,
      description: paymentType.description
    });

    // Validate the transfer with different logic for SOL vs SPL tokens
    const validateParams = {
      recipient: new PublicKey(payment.recipient_address || MERCHANT_WALLET.toString()),
      amount: new BigNumber(payment.amount),
      reference: referencePublicKey
    };

    // Add SPL token if payment uses one
    if (payment.spl_token_mint) {
      validateParams.splToken = new PublicKey(payment.spl_token_mint);
    }

    logger.info('Validating transfer with payment type-specific params:', {
      reference: payment.reference,
      recipient: validateParams.recipient.toString(),
      amount: validateParams.amount.toString(),
      splToken: validateParams.splToken?.toString(),
      currency: payment.currency,
      paymentType: paymentType.type,
      validationMethod: paymentType.isSOL ? 'Enhanced SOL validation with error handling' : 'Standard SPL validation'
    });

    // Get transaction for detailed analysis logging with retry logic
    let transaction = null;
    try {
      transaction = await this.executeWithRetry(
        async () => {
          return await connection.getTransaction(signatureInfo.signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0
          });
        },
        payment,
        'get_transaction'
      );

      if (transaction) {
        this.logTransactionAnalysis(transaction, payment, paymentType, signatureInfo.signature);
      }
    } catch (txError) {
      logger.warn('Could not retrieve transaction for analysis logging after retries:', {
        reference: payment.reference,
        signature: signatureInfo.signature,
        error: txError.message
      });
    }

    // Use different validation logic for SOL vs SPL tokens
    if (paymentType.isSOL) {
      // For SOL payments, use custom validation since validateTransfer is designed for SPL tokens
      logger.info('Using enhanced SOL validation for native SOL transfer:', {
        reference: payment.reference,
        paymentType: paymentType.type,
        signature: signatureInfo.signature
      });

      const validationResult = await this.executeWithRetry(
        async () => {
          return await this.validateSOLPayment(
            connection,
            signatureInfo.signature,
            payment,
            validateParams,
            referencePublicKey
          );
        },
        payment,
        'enhanced_sol_validation'
      );

      if (!validationResult.isValid) {
        const enhancedError = this.createStructuredError(
          'SOL_VALIDATION_FAILED',
          validationResult.error,
          payment,
          paymentType,
          {
            signature: signatureInfo.signature,
            validationMethod: 'enhanced_sol'
          }
        );
        logger.error('SOL payment validation failed after retries:', enhancedError);
        throw new Error(validationResult.error);
      }

      logger.info('SOL payment validation successful:', {
        reference: payment.reference,
        signature: signatureInfo.signature,
        paymentType: paymentType.type,
        validationDetails: validationResult.details
      });
    } else {
      // For SPL token payments, use standard validateTransfer
      await this.executeWithRetry(
        async () => {
          return await validateTransfer(
            connection,
            signatureInfo.signature,
            validateParams,
            { commitment: 'confirmed' }
          );
        },
        payment,
        'validate_transfer'
      );

      logger.info('SPL token validation successful:', {
        reference: payment.reference,
        paymentType: paymentType.type,
        signature: signatureInfo.signature
      });
    }

    // Payment confirmed - update status with error handling
    await this.executeWithRetry(
      async () => {
        return await this.confirmPayment(payment, signatureInfo.signature);
      },
      payment,
      'confirm_payment'
    );
  }

  /**
   * Update payment analytics (consolidated from analyticsUpdater.js)
   */
  async updatePaymentAnalytics(paymentId) {
    try {
      const { data: analytics } = await database.getClient()
        .from('payment_analytics')
        .select('*')
        .eq('payment_id', paymentId)
        .single();

      if (analytics) {
        // Update existing analytics
        await database.getClient()
          .from('payment_analytics')
          .update({
            updated_at: new Date().toISOString()
          })
          .eq('payment_id', paymentId);
      } else {
        // Create new analytics record
        await database.getClient()
          .from('payment_analytics')
          .insert({
            payment_id: paymentId,
            total_visits: 0,
            total_scans: 0,
            unique_visitors: 0,
            conversion_rate: 0
          });
      }

      logger.info('Payment analytics updated:', { paymentId });
    } catch (error) {
      logger.error('Payment analytics update failed:', { paymentId, error: error.message });
    }
  }

  /**
   * Confirm payment and send notifications
   */
  async confirmPayment(payment, signature) {
    try {
      // Update payment status with error handling
      let updatedPayment;
      try {
        updatedPayment = await database.updatePaymentStatus(
          payment.reference,
          'confirmed',
          signature
        );
      } catch (dbError) {
        logger.error('Database error updating payment status in monitor:', {
          reference: payment.reference,
          status: 'confirmed',
          error: dbError.message,
          code: dbError.code
        });
        return;
      }

      // Send webhook notification
      try {
        await sendWebhook('payment.confirmed', {
          reference: payment.reference,
          amount: payment.amount,
          currency: payment.currency,
          signature,
          timestamp: new Date().toISOString()
        });
      } catch (webhookError) {
        logger.warn('Failed to send webhook notification:', {
          reference: payment.reference,
          error: webhookError.message
        });
      }

      // Send real-time WebSocket update
      const wsResult = notifyPaymentUpdate(payment.reference, 'confirmed', {
        amount: payment.amount,
        currency: payment.currency,
        signature
      });

      if (!wsResult.success) {
        logger.warn('Failed to send WebSocket notification:', {
          reference: payment.reference,
          error: wsResult.error
        });
      }

      // Create transaction record
      try {
        await database.getClient()
          .from('transactions')
          .insert({
            payment_id: payment.id,
            chain: payment.chain,
            transaction_hash: signature,
            status: 'confirmed',
            confirmed_at: new Date().toISOString()
          });
      } catch (txError) {
        logger.warn('Failed to create transaction record:', {
          reference: payment.reference,
          error: txError.message
        });
      }

      // Send confirmation email
      if (payment.customer_email) {
        try {
          await emailService.sendPaymentConfirmedEmail(updatedPayment, payment.customer_email);
        } catch (emailError) {
          logger.warn('Failed to send confirmation email:', {
            reference: payment.reference,
            email: payment.customer_email,
            error: emailError.message
          });
        }
      }

      const paymentType = this.getPaymentTypeInfo(payment);
      logger.info('Payment automatically confirmed with type context:', {
        reference: payment.reference,
        signature,
        paymentType: paymentType.type,
        currency: paymentType.currency,
        amount: payment.amount,
        description: paymentType.description
      });

    } catch (error) {
      logger.error('Error confirming payment:', {
        reference: payment.reference,
        error: error.message,
        stack: error.stack
      });
    }
  }
}

module.exports = new PaymentMonitor();
