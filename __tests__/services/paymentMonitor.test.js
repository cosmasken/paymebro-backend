const paymentMonitor = require('../../src/services/paymentMonitor');
const database = require('../../src/services/database');
const logger = require('../../src/utils/logger');

// Mock all dependencies
jest.mock('../../src/services/database');
jest.mock('../../src/utils/logger');

describe('Payment Monitor Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getPaymentTypeInfo', () => {
    it('should identify SOL payment correctly', () => {
      const solPayment = {
        currency: 'SOL',
        spl_token_mint: null,
        amount: '1.5'
      };

      const result = paymentMonitor.getPaymentTypeInfo(solPayment);

      expect(result).toEqual({
        type: 'SOL',
        isSOL: true,
        isSPLToken: false,
        currency: 'SOL',
        tokenMint: null,
        description: 'Native SOL Transfer'
      });
    });

    it('should identify SPL token payment correctly', () => {
      const splPayment = {
        currency: 'USDC',
        spl_token_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: '100'
      };

      const result = paymentMonitor.getPaymentTypeInfo(splPayment);

      expect(result).toEqual({
        type: 'SPL_TOKEN',
        isSOL: false,
        isSPLToken: true,
        currency: 'USDC',
        tokenMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        description: 'SPL Token Transfer (USDC)'
      });
    });

    it('should handle lowercase SOL currency', () => {
      const solPayment = {
        currency: 'sol',
        spl_token_mint: null,
        amount: '0.5'
      };

      const result = paymentMonitor.getPaymentTypeInfo(solPayment);

      expect(result.type).toBe('SOL');
      expect(result.isSOL).toBe(true);
    });
  });

  describe('createStructuredError', () => {
    it('should create structured error with payment context', () => {
      const payment = {
        reference: 'test-ref-123',
        amount: '1.0',
        currency: 'SOL'
      };
      const paymentType = {
        type: 'SOL',
        currency: 'SOL',
        tokenMint: null,
        description: 'Native SOL Transfer'
      };

      const result = paymentMonitor.createStructuredError(
        'TEST_ERROR',
        'Test error message',
        payment,
        paymentType,
        { additionalInfo: 'test' }
      );

      expect(result).toMatchObject({
        errorType: 'TEST_ERROR',
        message: 'Test error message',
        paymentContext: {
          reference: 'test-ref-123',
          paymentType: 'SOL',
          currency: 'SOL',
          amount: '1.0',
          tokenMint: null,
          description: 'Native SOL Transfer'
        },
        additionalContext: { additionalInfo: 'test' }
      });
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('logTransactionAnalysis', () => {
    it('should log transaction analysis for SOL payment', () => {
      const mockTransaction = {
        transaction: {
          message: {
            version: 'legacy',
            accountKeys: ['key1', 'key2'],
            instructions: [{ programIdIndex: 0 }]
          }
        },
        meta: {
          err: null,
          preBalances: [1000000, 2000000],
          postBalances: [500000, 2500000]
        }
      };

      const payment = {
        reference: 'test-ref',
        currency: 'SOL'
      };

      const paymentType = {
        type: 'SOL',
        isSOL: true,
        isSPLToken: false,
        currency: 'SOL',
        tokenMint: null
      };

      // Mock getTransactionAccountKeys to return the account keys
      const mockGetAccountKeys = jest.spyOn(paymentMonitor, 'getTransactionAccountKeys').mockReturnValue(['key1', 'key2']);

      paymentMonitor.logTransactionAnalysis(mockTransaction, payment, paymentType, 'test-signature');

      expect(logger.info).toHaveBeenCalledWith(
        'Transaction analysis for payment validation:',
        expect.objectContaining({
          reference: 'test-ref',
          signature: 'test-signature',
          paymentType: 'SOL',
          currency: 'SOL',
          transactionDetails: expect.objectContaining({
            version: 'legacy',
            accountKeysCount: 2,
            instructionsCount: 1,
            hasMetadata: true,
            transactionSuccess: true,
            error: null
          }),
          balanceAnalysis: expect.objectContaining({
            hasPreBalances: true,
            hasPostBalances: true,
            preBalancesCount: 2,
            postBalancesCount: 2
          })
        })
      );

      // Restore the original method
      mockGetAccountKeys.mockRestore();
    });
  });

  describe('getTransactionAccountKeys', () => {
    it('should handle legacy transaction format', () => {
      const mockAccountKeys = ['key1', 'key2', 'key3'];
      const legacyMessage = {
        version: 'legacy',
        accountKeys: mockAccountKeys
      };

      const result = paymentMonitor.getTransactionAccountKeys(legacyMessage);

      expect(result).toBe(mockAccountKeys);
    });

    it('should handle undefined version as legacy transaction', () => {
      const mockAccountKeys = ['key1', 'key2', 'key3'];
      const legacyMessage = {
        accountKeys: mockAccountKeys
      };

      const result = paymentMonitor.getTransactionAccountKeys(legacyMessage);

      expect(result).toBe(mockAccountKeys);
    });

    it('should handle versioned transaction format', () => {
      const mockAccountKeys = ['key1', 'key2', 'key3'];
      const versionedMessage = {
        version: 0,
        getAccountKeys: jest.fn().mockReturnValue(mockAccountKeys)
      };

      const result = paymentMonitor.getTransactionAccountKeys(versionedMessage);

      expect(result).toBe(mockAccountKeys);
      expect(versionedMessage.getAccountKeys).toHaveBeenCalledTimes(1);
    });

    it('should throw error for legacy transaction missing accountKeys', () => {
      const legacyMessage = {
        version: 'legacy'
        // missing accountKeys property
      };

      expect(() => {
        paymentMonitor.getTransactionAccountKeys(legacyMessage);
      }).toThrow('Legacy transaction missing accountKeys property');
    });

    it('should throw error for versioned transaction missing getAccountKeys method', () => {
      const versionedMessage = {
        version: 0
        // missing getAccountKeys method
      };

      expect(() => {
        paymentMonitor.getTransactionAccountKeys(versionedMessage);
      }).toThrow('Versioned transaction missing getAccountKeys method');
    });

    it('should handle errors from getAccountKeys method', () => {
      const versionedMessage = {
        version: 0,
        getAccountKeys: jest.fn().mockImplementation(() => {
          throw new Error('RPC error');
        })
      };

      expect(() => {
        paymentMonitor.getTransactionAccountKeys(versionedMessage);
      }).toThrow('Failed to extract account keys: RPC error');
    });

    describe('Versioned transaction parsing logic', () => {
      it('should handle v0 versioned transactions correctly', () => {
        const mockAccountKeys = ['key1', 'key2', 'key3', 'key4'];
        const v0Message = {
          version: 0,
          getAccountKeys: jest.fn().mockReturnValue(mockAccountKeys)
        };

        const result = paymentMonitor.getTransactionAccountKeys(v0Message);

        expect(result).toBe(mockAccountKeys);
        expect(v0Message.getAccountKeys).toHaveBeenCalledTimes(1);
      });

      it('should handle v1 versioned transactions correctly', () => {
        const mockAccountKeys = ['key1', 'key2', 'key3'];
        const v1Message = {
          version: 1,
          getAccountKeys: jest.fn().mockReturnValue(mockAccountKeys)
        };

        const result = paymentMonitor.getTransactionAccountKeys(v1Message);

        expect(result).toBe(mockAccountKeys);
        expect(v1Message.getAccountKeys).toHaveBeenCalledTimes(1);
      });

      it('should handle versioned transactions with address lookup tables', () => {
        const mockAccountKeys = [
          'program1', 'program2', 'account1', 'account2',
          'lookupAccount1', 'lookupAccount2' // From address lookup tables
        ];
        const versionedMessage = {
          version: 0,
          getAccountKeys: jest.fn().mockReturnValue(mockAccountKeys),
          addressTableLookups: [
            { accountKey: 'lookupTable1', writableIndexes: [0], readonlyIndexes: [1] }
          ]
        };

        const result = paymentMonitor.getTransactionAccountKeys(versionedMessage);

        expect(result).toBe(mockAccountKeys);
        expect(result.length).toBe(6);
        expect(versionedMessage.getAccountKeys).toHaveBeenCalledTimes(1);
      });

      it('should handle versioned transactions with empty address lookup tables', () => {
        const mockAccountKeys = ['key1', 'key2'];
        const versionedMessage = {
          version: 0,
          getAccountKeys: jest.fn().mockReturnValue(mockAccountKeys),
          addressTableLookups: []
        };

        const result = paymentMonitor.getTransactionAccountKeys(versionedMessage);

        expect(result).toBe(mockAccountKeys);
        expect(result.length).toBe(2);
      });

      it('should handle versioned transaction parsing with complex account structures', () => {
        const mockAccountKeys = [
          'systemProgram',
          'tokenProgram',
          'associatedTokenProgram',
          'senderAccount',
          'recipientAccount',
          'referenceAccount',
          'feePayerAccount'
        ];
        const complexVersionedMessage = {
          version: 0,
          getAccountKeys: jest.fn().mockReturnValue(mockAccountKeys),
          header: {
            numRequiredSignatures: 2,
            numReadonlySignedAccounts: 0,
            numReadonlyUnsignedAccounts: 3
          }
        };

        const result = paymentMonitor.getTransactionAccountKeys(complexVersionedMessage);

        expect(result).toBe(mockAccountKeys);
        expect(result.length).toBe(7);
        expect(complexVersionedMessage.getAccountKeys).toHaveBeenCalledTimes(1);
      });

      it('should handle versioned transaction parsing errors gracefully', () => {
        const versionedMessage = {
          version: 0,
          getAccountKeys: jest.fn().mockImplementation(() => {
            throw new Error('Address lookup table resolution failed');
          })
        };

        expect(() => {
          paymentMonitor.getTransactionAccountKeys(versionedMessage);
        }).toThrow('Failed to extract account keys: Address lookup table resolution failed');
      });

      it('should handle mixed legacy and versioned transaction scenarios', () => {
        // Test that the function correctly identifies transaction types
        const legacyMessage = {
          version: 'legacy',
          accountKeys: ['key1', 'key2']
        };

        const versionedMessage = {
          version: 0,
          getAccountKeys: jest.fn().mockReturnValue(['key3', 'key4'])
        };

        const legacyResult = paymentMonitor.getTransactionAccountKeys(legacyMessage);
        const versionedResult = paymentMonitor.getTransactionAccountKeys(versionedMessage);

        expect(legacyResult).toEqual(['key1', 'key2']);
        expect(versionedResult).toEqual(['key3', 'key4']);
        expect(versionedMessage.getAccountKeys).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('getConnection', () => {
    it('should return existing connection if already established', async () => {
      const mockConnection = { mock: 'connection' };
      paymentMonitor.connection = mockConnection;

      const connection = await paymentMonitor.getConnection();

      expect(connection).toBe(mockConnection);
    });
  });

  describe('checkPendingPayments', () => {
    it('should process pending payments successfully', async () => {
      const mockPendingPayments = [
        { id: 'payment-1', reference: 'ref-1', status: 'pending' },
        { id: 'payment-2', reference: 'ref-2', status: 'pending' }
      ];

      database.getClient.mockReturnValue({
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: mockPendingPayments })
      });

      paymentMonitor.checkPaymentConfirmation = jest.fn();

      await paymentMonitor.checkPendingPayments();

      expect(paymentMonitor.checkPaymentConfirmation).toHaveBeenCalledTimes(2);
    });

    it('should handle empty pending payments', async () => {
      database.getClient.mockReturnValue({
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [] })
      });

      paymentMonitor.checkPaymentConfirmation = jest.fn();

      await paymentMonitor.checkPendingPayments();

      expect(paymentMonitor.checkPaymentConfirmation).not.toHaveBeenCalled();
    });
  });

  describe('validateSOLAmount', () => {
    const mockPayment = {
      reference: 'test-ref',
      amount: '1.5' // 1.5 SOL
    };

    const mockValidateParams = {
      recipient: {
        equals: jest.fn().mockReturnValue(true)
      }
    };

    it('should validate SOL amount successfully with exact match', () => {
      const mockTransaction = {
        meta: {
          preBalances: [1000000000, 500000000], // 1 SOL, 0.5 SOL
          postBalances: [2500000000, 500000000]  // 2.5 SOL, 0.5 SOL (1.5 SOL transfer)
        }
      };

      const mockAccountKeys = [
        { equals: jest.fn().mockReturnValue(true) },  // recipient at index 0
        { equals: jest.fn().mockReturnValue(false) }
      ];

      const result = paymentMonitor.validateSOLAmount(
        mockTransaction,
        mockPayment,
        mockValidateParams,
        mockAccountKeys
      );

      expect(result.isValid).toBe(true);
      expect(result.details.actualTransferLamports).toBe('1500000000'); // 1.5 SOL in lamports
      expect(result.details.expectedLamports).toBe('1500000000');
    });

    it('should validate SOL amount with acceptable tolerance', () => {
      const mockTransaction = {
        meta: {
          preBalances: [1000000000, 500000000],
          postBalances: [2495000000, 500000000]  // 1.495 SOL transfer (within 0.5% tolerance)
        }
      };

      const mockAccountKeys = [
        { equals: jest.fn().mockReturnValue(true) },
        { equals: jest.fn().mockReturnValue(false) }
      ];

      const result = paymentMonitor.validateSOLAmount(
        mockTransaction,
        mockPayment,
        mockValidateParams,
        mockAccountKeys
      );

      expect(result.isValid).toBe(true);
      expect(result.details.actualTransferLamports).toBe('1495000000');
    });

    it('should reject SOL amount below tolerance threshold', () => {
      const mockTransaction = {
        meta: {
          preBalances: [1000000000, 500000000],
          postBalances: [2400000000, 500000000]  // 1.4 SOL transfer (too low)
        }
      };

      const mockAccountKeys = [
        { equals: jest.fn().mockReturnValue(true) },
        { equals: jest.fn().mockReturnValue(false) }
      ];

      const result = paymentMonitor.validateSOLAmount(
        mockTransaction,
        mockPayment,
        mockValidateParams,
        mockAccountKeys
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('SOL transfer amount too low');
    });

    it('should handle missing transaction metadata', () => {
      const mockTransaction = {
        meta: null
      };

      const mockAccountKeys = [
        { equals: jest.fn().mockReturnValue(true) }
      ];

      const result = paymentMonitor.validateSOLAmount(
        mockTransaction,
        mockPayment,
        mockValidateParams,
        mockAccountKeys
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Transaction metadata incomplete');
    });

    it('should handle recipient not found in account keys', () => {
      const mockTransaction = {
        meta: {
          preBalances: [1000000000],
          postBalances: [2500000000]
        }
      };

      const mockAccountKeys = [
        { equals: jest.fn().mockReturnValue(false) } // recipient not found
      ];

      const result = paymentMonitor.validateSOLAmount(
        mockTransaction,
        mockPayment,
        mockValidateParams,
        mockAccountKeys
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Recipient address not found in transaction');
    });

    it('should handle micro-transactions with minimum tolerance', () => {
      const microPayment = {
        reference: 'test-ref',
        amount: '0.000001' // Very small SOL amount
      };

      const mockTransaction = {
        meta: {
          preBalances: [1000000000],
          postBalances: [1000000999]  // 999 lamports transfer (within minimum tolerance)
        }
      };

      const mockAccountKeys = [
        { equals: jest.fn().mockReturnValue(true) }
      ];

      const result = paymentMonitor.validateSOLAmount(
        mockTransaction,
        microPayment,
        mockValidateParams,
        mockAccountKeys
      );

      expect(result.isValid).toBe(true);
    });

    describe('SOL amount validation with various fee scenarios', () => {
      it('should handle network fee deductions within tolerance', () => {
        const payment = {
          reference: 'test-ref',
          amount: '1.0' // 1 SOL
        };

        const mockTransaction = {
          meta: {
            preBalances: [500000000], // 0.5 SOL (recipient's initial balance)
            postBalances: [1495000000]  // 1.495 SOL (received 0.995 SOL after fees, within tolerance)
          }
        };

        const mockAccountKeys = [
          { equals: jest.fn().mockReturnValue(true) }
        ];

        const result = paymentMonitor.validateSOLAmount(
          mockTransaction,
          payment,
          mockValidateParams,
          mockAccountKeys
        );

        expect(result.isValid).toBe(true);
        expect(result.details.actualTransferLamports).toBe('995000000'); // 0.995 SOL received
      });

      it('should reject payments with excessive fee deductions', () => {
        const payment = {
          reference: 'test-ref',
          amount: '1.0' // 1 SOL
        };

        const mockTransaction = {
          meta: {
            preBalances: [2000000000], // 2 SOL
            postBalances: [900000000]  // 0.9 SOL (0.1 SOL fee - too high)
          }
        };

        const mockAccountKeys = [
          { equals: jest.fn().mockReturnValue(true) }
        ];

        const result = paymentMonitor.validateSOLAmount(
          mockTransaction,
          payment,
          mockValidateParams,
          mockAccountKeys
        );

        expect(result.isValid).toBe(false);
        expect(result.error).toContain('SOL transfer amount too low');
      });

      it('should handle rent exemption scenarios', () => {
        const payment = {
          reference: 'test-ref',
          amount: '0.002' // Small SOL amount for rent exemption
        };

        const mockTransaction = {
          meta: {
            preBalances: [0], // New account
            postBalances: [2039280] // Slightly more than expected due to rent exemption
          }
        };

        const mockAccountKeys = [
          { equals: jest.fn().mockReturnValue(true) }
        ];

        const result = paymentMonitor.validateSOLAmount(
          mockTransaction,
          payment,
          mockValidateParams,
          mockAccountKeys
        );

        expect(result.isValid).toBe(true);
      });

      it('should handle priority fee scenarios', () => {
        const payment = {
          reference: 'test-ref',
          amount: '0.5' // 0.5 SOL
        };

        const mockTransaction = {
          meta: {
            preBalances: [1000000000], // 1 SOL
            postBalances: [1499995000] // 0.499995 SOL received (5000 lamports priority fee)
          }
        };

        const mockAccountKeys = [
          { equals: jest.fn().mockReturnValue(true) }
        ];

        const result = paymentMonitor.validateSOLAmount(
          mockTransaction,
          payment,
          mockValidateParams,
          mockAccountKeys
        );

        expect(result.isValid).toBe(true);
        expect(result.details.actualTransferLamports).toBe('499995000');
      });

      it('should handle large transaction fees for high-value transfers', () => {
        const payment = {
          reference: 'test-ref',
          amount: '100.0' // 100 SOL
        };

        const mockTransaction = {
          meta: {
            preBalances: [50000000000], // 50 SOL
            postBalances: [149990000000] // 149.99 SOL (0.01 SOL fee, within 0.5% tolerance)
          }
        };

        const mockAccountKeys = [
          { equals: jest.fn().mockReturnValue(true) }
        ];

        const result = paymentMonitor.validateSOLAmount(
          mockTransaction,
          payment,
          mockValidateParams,
          mockAccountKeys
        );

        expect(result.isValid).toBe(true);
        expect(result.details.actualTransferLamports).toBe('99990000000');
      });
    });
  });

  describe('validateAccountBasedReference', () => {
    const mockPayment = {
      reference: 'test-ref',
      amount: '1.0'
    };

    const mockPaymentType = {
      type: 'SOL',
      currency: 'SOL'
    };

    const mockReferencePublicKey = {
      equals: jest.fn(),
      toString: jest.fn().mockReturnValue('test-reference-key')
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should find reference in account keys', () => {
      const mockAccountKeys = [
        { equals: jest.fn().mockReturnValue(false), toString: jest.fn().mockReturnValue('key1') },
        { equals: jest.fn().mockReturnValue(true), toString: jest.fn().mockReturnValue('test-reference-key') },
        { equals: jest.fn().mockReturnValue(false), toString: jest.fn().mockReturnValue('key3') }
      ];

      const result = paymentMonitor.validateAccountBasedReference(
        mockAccountKeys,
        mockReferencePublicKey,
        mockPayment,
        mockPaymentType,
        'test-signature'
      );

      expect(result.found).toBe(true);
      expect(result.referenceIndex).toBe(1);
      expect(result.method).toBe('account-based');
    });

    it('should not find reference when not in account keys', () => {
      const mockAccountKeys = [
        { equals: jest.fn().mockReturnValue(false), toString: jest.fn().mockReturnValue('key1') },
        { equals: jest.fn().mockReturnValue(false), toString: jest.fn().mockReturnValue('key2') }
      ];

      const result = paymentMonitor.validateAccountBasedReference(
        mockAccountKeys,
        mockReferencePublicKey,
        mockPayment,
        mockPaymentType,
        'test-signature'
      );

      expect(result.found).toBe(false);
      expect(result.referenceIndex).toBe(-1);
      expect(result.accountKeysChecked).toBe(2);
    });

    it('should handle comparison errors gracefully', () => {
      const mockAccountKeys = [
        { equals: jest.fn().mockImplementation(() => { throw new Error('Comparison error'); }), toString: jest.fn().mockReturnValue('key1') },
        { equals: jest.fn().mockReturnValue(true), toString: jest.fn().mockReturnValue('test-reference-key') }
      ];

      const result = paymentMonitor.validateAccountBasedReference(
        mockAccountKeys,
        mockReferencePublicKey,
        mockPayment,
        mockPaymentType,
        'test-signature'
      );

      expect(result.found).toBe(true);
      expect(result.referenceIndex).toBe(1);
    });
  });

  describe('validateMemoBasedReference', () => {
    const mockPayment = {
      reference: 'test-ref',
      amount: '1.0'
    };

    const mockPaymentType = {
      type: 'SOL',
      currency: 'SOL'
    };

    const mockReferencePublicKey = {
      toString: jest.fn().mockReturnValue('test-reference-key')
    };

    beforeEach(() => {
      jest.clearAllMocks();
      paymentMonitor.getTransactionAccountKeys = jest.fn();
    });

    it('should find reference in memo instruction', () => {
      const mockTransaction = {
        transaction: {
          message: {
            instructions: [
              {
                programIdIndex: 0,
                data: Buffer.from('Payment reference: test-reference-key', 'utf8')
              }
            ]
          }
        }
      };

      const mockAccountKeys = [
        { equals: jest.fn().mockReturnValue(true), toString: jest.fn().mockReturnValue('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') }
      ];

      paymentMonitor.getTransactionAccountKeys.mockReturnValue(mockAccountKeys);

      const result = paymentMonitor.validateMemoBasedReference(
        mockTransaction,
        mockReferencePublicKey,
        mockPayment,
        mockPaymentType,
        'test-signature'
      );

      expect(result.found).toBe(true);
      expect(result.method).toBe('memo-based');
      expect(result.memoInstructionsFound).toBe(1);
      expect(result.matchingMemoIndex).toBe(0);
    });

    it('should not find reference when not in memo', () => {
      const mockTransaction = {
        transaction: {
          message: {
            instructions: [
              {
                programIdIndex: 0,
                data: Buffer.from('Some other memo text', 'utf8')
              }
            ]
          }
        }
      };

      const mockAccountKeys = [
        { equals: jest.fn().mockReturnValue(true), toString: jest.fn().mockReturnValue('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') }
      ];

      paymentMonitor.getTransactionAccountKeys.mockReturnValue(mockAccountKeys);

      const result = paymentMonitor.validateMemoBasedReference(
        mockTransaction,
        mockReferencePublicKey,
        mockPayment,
        mockPaymentType,
        'test-signature'
      );

      expect(result.found).toBe(false);
      expect(result.memoInstructionsFound).toBe(1);
      expect(result.matchingMemoIndex).toBe(-1);
    });

    it('should handle transactions with no memo instructions', () => {
      const mockTransaction = {
        transaction: {
          message: {
            instructions: [
              {
                programIdIndex: 0,
                data: Buffer.from('transfer instruction', 'utf8')
              }
            ]
          }
        }
      };

      const mockAccountKeys = [
        { equals: jest.fn().mockReturnValue(false), toString: jest.fn().mockReturnValue('11111111111111111111111111111112') } // System program
      ];

      paymentMonitor.getTransactionAccountKeys.mockReturnValue(mockAccountKeys);

      const result = paymentMonitor.validateMemoBasedReference(
        mockTransaction,
        mockReferencePublicKey,
        mockPayment,
        mockPaymentType,
        'test-signature'
      );

      expect(result.found).toBe(false);
      expect(result.memoInstructionsFound).toBe(0);
    });

    it('should handle account key extraction errors', () => {
      const mockTransaction = {
        transaction: {
          message: {
            instructions: []
          }
        }
      };

      paymentMonitor.getTransactionAccountKeys.mockImplementation(() => {
        throw new Error('Account key extraction failed');
      });

      const result = paymentMonitor.validateMemoBasedReference(
        mockTransaction,
        mockReferencePublicKey,
        mockPayment,
        mockPaymentType,
        'test-signature'
      );

      expect(result.found).toBe(false);
      expect(result.error).toContain('Could not extract account keys for memo validation');
    });
  });

  describe('validateSOLTransactionReference', () => {
    const mockPayment = {
      reference: 'test-ref',
      amount: '1.0'
    };

    const mockPaymentType = {
      type: 'SOL',
      currency: 'SOL'
    };

    const mockReferencePublicKey = {
      toString: jest.fn().mockReturnValue('test-reference-key')
    };

    const mockTransaction = {
      transaction: {
        message: {
          instructions: []
        }
      }
    };

    const mockAccountKeys = [];

    beforeEach(() => {
      jest.clearAllMocks();
      paymentMonitor.validateAccountBasedReference = jest.fn();
      paymentMonitor.validateMemoBasedReference = jest.fn();
    });

    it('should validate reference found via account-based method', () => {
      paymentMonitor.validateAccountBasedReference.mockReturnValue({
        found: true,
        method: 'account-based',
        referenceIndex: 1
      });
      paymentMonitor.validateMemoBasedReference.mockReturnValue({
        found: false,
        method: 'memo-based'
      });

      const result = paymentMonitor.validateSOLTransactionReference(
        mockTransaction,
        mockReferencePublicKey,
        mockAccountKeys,
        mockPayment,
        mockPaymentType,
        'test-signature'
      );

      expect(result.isValid).toBe(true);
      expect(result.details.validationMethod).toBe('account-based');
    });

    it('should validate reference found via memo-based method', () => {
      paymentMonitor.validateAccountBasedReference.mockReturnValue({
        found: false,
        method: 'account-based'
      });
      paymentMonitor.validateMemoBasedReference.mockReturnValue({
        found: true,
        method: 'memo-based',
        matchingMemoIndex: 0
      });

      const result = paymentMonitor.validateSOLTransactionReference(
        mockTransaction,
        mockReferencePublicKey,
        mockAccountKeys,
        mockPayment,
        mockPaymentType,
        'test-signature'
      );

      expect(result.isValid).toBe(true);
      expect(result.details.validationMethod).toBe('memo-based');
    });

    it('should fail when reference not found via either method', () => {
      paymentMonitor.validateAccountBasedReference.mockReturnValue({
        found: false,
        method: 'account-based'
      });
      paymentMonitor.validateMemoBasedReference.mockReturnValue({
        found: false,
        method: 'memo-based'
      });

      const result = paymentMonitor.validateSOLTransactionReference(
        mockTransaction,
        mockReferencePublicKey,
        mockAccountKeys,
        mockPayment,
        mockPaymentType,
        'test-signature'
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Reference key not found in SOL transaction');
    });

    it('should handle validation exceptions', () => {
      paymentMonitor.validateAccountBasedReference.mockImplementation(() => {
        throw new Error('Validation exception');
      });

      const result = paymentMonitor.validateSOLTransactionReference(
        mockTransaction,
        mockReferencePublicKey,
        mockAccountKeys,
        mockPayment,
        mockPaymentType,
        'test-signature'
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Reference validation error');
    });

    describe('SOL transaction reference validation scenarios', () => {
      beforeEach(() => {
        paymentMonitor.validateAccountBasedReference = jest.fn();
        paymentMonitor.validateMemoBasedReference = jest.fn();
      });

      it('should validate reference in multi-signature SOL transactions', () => {
        const multiSigTransaction = {
          transaction: {
            message: {
              instructions: [
                { programIdIndex: 0, accounts: [0, 1, 2, 3] }, // Multi-sig instruction
                { programIdIndex: 1, accounts: [4, 5] }        // Transfer instruction
              ]
            }
          }
        };

        const multiSigAccountKeys = [
          { equals: jest.fn().mockReturnValue(false) }, // System program
          { equals: jest.fn().mockReturnValue(false) }, // Multi-sig program
          { equals: jest.fn().mockReturnValue(false) }, // Multi-sig account
          { equals: jest.fn().mockReturnValue(true) },  // Reference key
          { equals: jest.fn().mockReturnValue(false) }, // Sender
          { equals: jest.fn().mockReturnValue(false) }  // Recipient
        ];

        paymentMonitor.validateAccountBasedReference.mockReturnValue({
          found: true,
          method: 'account-based',
          referenceIndex: 3
        });
        paymentMonitor.validateMemoBasedReference.mockReturnValue({
          found: false,
          method: 'memo-based'
        });

        const result = paymentMonitor.validateSOLTransactionReference(
          multiSigTransaction,
          mockReferencePublicKey,
          multiSigAccountKeys,
          mockPayment,
          mockPaymentType,
          'test-signature'
        );

        expect(result.isValid).toBe(true);
        expect(result.details.validationMethod).toBe('account-based');
        expect(result.details.accountBasedReference.referenceIndex).toBe(3);
      });

      it('should validate reference in SOL transactions with program derived addresses', () => {
        const pdaTransaction = {
          transaction: {
            message: {
              instructions: [
                { programIdIndex: 0, accounts: [1, 2, 3] } // PDA-based transfer
              ]
            }
          }
        };

        const pdaAccountKeys = [
          { equals: jest.fn().mockReturnValue(false) }, // System program
          { equals: jest.fn().mockReturnValue(false) }, // PDA account
          { equals: jest.fn().mockReturnValue(true) },  // Reference key (derived)
          { equals: jest.fn().mockReturnValue(false) }  // Recipient
        ];

        paymentMonitor.validateAccountBasedReference.mockReturnValue({
          found: true,
          method: 'account-based',
          referenceIndex: 2,
          isPDA: true
        });
        paymentMonitor.validateMemoBasedReference.mockReturnValue({
          found: false,
          method: 'memo-based'
        });

        const result = paymentMonitor.validateSOLTransactionReference(
          pdaTransaction,
          mockReferencePublicKey,
          pdaAccountKeys,
          mockPayment,
          mockPaymentType,
          'test-signature'
        );

        expect(result.isValid).toBe(true);
        expect(result.details.validationMethod).toBe('account-based');
      });

      it('should validate reference in SOL transactions with memo instructions', () => {
        const memoTransaction = {
          transaction: {
            message: {
              instructions: [
                { programIdIndex: 0, accounts: [1, 2] },    // Transfer instruction
                { programIdIndex: 3, data: Buffer.from('Payment ref: test-reference-key') } // Memo
              ]
            }
          }
        };

        paymentMonitor.validateAccountBasedReference.mockReturnValue({
          found: false,
          method: 'account-based'
        });
        paymentMonitor.validateMemoBasedReference.mockReturnValue({
          found: true,
          method: 'memo-based',
          matchingMemoIndex: 1,
          memoContent: 'Payment ref: test-reference-key'
        });

        const result = paymentMonitor.validateSOLTransactionReference(
          memoTransaction,
          mockReferencePublicKey,
          mockAccountKeys,
          mockPayment,
          mockPaymentType,
          'test-signature'
        );

        expect(result.isValid).toBe(true);
        expect(result.details.validationMethod).toBe('memo-based');
        expect(result.details.memoBasedReference.matchingMemoIndex).toBe(1);
      });

      it('should handle SOL transactions with both account and memo references', () => {
        // Test priority: account-based validation takes precedence
        paymentMonitor.validateAccountBasedReference.mockReturnValue({
          found: true,
          method: 'account-based',
          referenceIndex: 2
        });
        paymentMonitor.validateMemoBasedReference.mockReturnValue({
          found: true,
          method: 'memo-based',
          matchingMemoIndex: 0
        });

        const result = paymentMonitor.validateSOLTransactionReference(
          mockTransaction,
          mockReferencePublicKey,
          mockAccountKeys,
          mockPayment,
          mockPaymentType,
          'test-signature'
        );

        expect(result.isValid).toBe(true);
        expect(result.details.validationMethod).toBe('account-based');
        expect(result.details.accountBasedReference.found).toBe(true);
        expect(result.details.memoBasedReference.found).toBe(true);
      });

      it('should handle SOL transactions with invalid reference formats', () => {
        paymentMonitor.validateAccountBasedReference.mockReturnValue({
          found: false,
          method: 'account-based',
          error: 'Invalid reference key format'
        });
        paymentMonitor.validateMemoBasedReference.mockReturnValue({
          found: false,
          method: 'memo-based',
          error: 'Memo parsing failed'
        });

        const result = paymentMonitor.validateSOLTransactionReference(
          mockTransaction,
          mockReferencePublicKey,
          mockAccountKeys,
          mockPayment,
          mockPaymentType,
          'test-signature'
        );

        expect(result.isValid).toBe(false);
        expect(result.error).toContain('Reference key not found in SOL transaction');
      });

      it('should handle SOL transactions with compressed account keys', () => {
        const compressedAccountKeys = [
          { equals: jest.fn().mockReturnValue(false) }, // System program
          { equals: jest.fn().mockReturnValue(true) },  // Compressed reference key
          { equals: jest.fn().mockReturnValue(false) }  // Recipient
        ];

        paymentMonitor.validateAccountBasedReference.mockReturnValue({
          found: true,
          method: 'account-based',
          referenceIndex: 1,
          isCompressed: true
        });
        paymentMonitor.validateMemoBasedReference.mockReturnValue({
          found: false,
          method: 'memo-based'
        });

        const result = paymentMonitor.validateSOLTransactionReference(
          mockTransaction,
          mockReferencePublicKey,
          compressedAccountKeys,
          mockPayment,
          mockPaymentType,
          'test-signature'
        );

        expect(result.isValid).toBe(true);
        expect(result.details.validationMethod).toBe('account-based');
      });

      it('should handle reference validation with network congestion scenarios', () => {
        // Simulate network congestion causing partial validation failures
        paymentMonitor.validateAccountBasedReference.mockImplementation(() => {
          throw new Error('Network timeout during account key comparison');
        });
        paymentMonitor.validateMemoBasedReference.mockReturnValue({
          found: true,
          method: 'memo-based',
          matchingMemoIndex: 0
        });

        const result = paymentMonitor.validateSOLTransactionReference(
          mockTransaction,
          mockReferencePublicKey,
          mockAccountKeys,
          mockPayment,
          mockPaymentType,
          'test-signature'
        );

        expect(result.isValid).toBe(false);
        expect(result.error).toContain('Reference validation error');
      });
    });
  });

  describe('validateSOLPayment', () => {
    const mockConnection = {
      getTransaction: jest.fn()
    };

    const mockPayment = {
      reference: 'test-ref',
      amount: '1.0'
    };

    const mockValidateParams = {
      recipient: {
        equals: jest.fn().mockReturnValue(true)
      }
    };

    const mockReferencePublicKey = {
      equals: jest.fn().mockReturnValue(true)
    };

    beforeEach(() => {
      jest.clearAllMocks();
      paymentMonitor.getTransactionAccountKeys = jest.fn();
      paymentMonitor.validateSOLAmount = jest.fn();
      paymentMonitor.validateSOLTransactionReference = jest.fn();
    });

    it('should validate SOL payment successfully', async () => {
      const mockTransaction = {
        meta: { err: null },
        transaction: {
          message: { version: 'legacy' }
        }
      };

      const mockAccountKeys = [
        { equals: jest.fn().mockReturnValue(true) }
      ];

      mockConnection.getTransaction.mockResolvedValue(mockTransaction);
      paymentMonitor.getTransactionAccountKeys.mockReturnValue(mockAccountKeys);
      paymentMonitor.validateSOLTransactionReference.mockReturnValue({
        isValid: true,
        details: { validationMethod: 'account-based' }
      });
      paymentMonitor.validateSOLAmount.mockReturnValue({
        isValid: true,
        details: { actualTransferLamports: '1000000000' }
      });

      const result = await paymentMonitor.validateSOLPayment(
        mockConnection,
        'test-signature',
        mockPayment,
        mockValidateParams,
        mockReferencePublicKey
      );

      expect(result.isValid).toBe(true);
      expect(result.details.referenceValidated).toBe(true);
      expect(result.details.amountValidated).toBe(true);
    });

    it('should handle RPC errors when retrieving transaction', async () => {
      mockConnection.getTransaction.mockRejectedValue(new Error('RPC connection failed'));

      const result = await paymentMonitor.validateSOLPayment(
        mockConnection,
        'test-signature',
        mockPayment,
        mockValidateParams,
        mockReferencePublicKey
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Failed to retrieve transaction');
    });

    it('should handle transaction not found', async () => {
      mockConnection.getTransaction.mockResolvedValue(null);

      const result = await paymentMonitor.validateSOLPayment(
        mockConnection,
        'test-signature',
        mockPayment,
        mockValidateParams,
        mockReferencePublicKey
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Failed to retrieve transaction: Transaction not found');
    });

    it('should handle failed transactions', async () => {
      const mockTransaction = {
        meta: { err: { InstructionError: [0, 'InvalidInstruction'] } },
        transaction: {
          message: { version: 'legacy' }
        }
      };

      mockConnection.getTransaction.mockResolvedValue(mockTransaction);

      const result = await paymentMonitor.validateSOLPayment(
        mockConnection,
        'test-signature',
        mockPayment,
        mockValidateParams,
        mockReferencePublicKey
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Transaction failed');
    });

    it('should handle reference key not found in transaction', async () => {
      const mockTransaction = {
        meta: { err: null },
        transaction: {
          message: { version: 'legacy' }
        }
      };

      const mockAccountKeys = [
        { equals: jest.fn().mockReturnValue(false) } // reference not found
      ];

      mockConnection.getTransaction.mockResolvedValue(mockTransaction);
      paymentMonitor.getTransactionAccountKeys.mockReturnValue(mockAccountKeys);
      paymentMonitor.validateSOLTransactionReference.mockReturnValue({
        isValid: false,
        error: 'Reference key not found in SOL transaction'
      });

      const result = await paymentMonitor.validateSOLPayment(
        mockConnection,
        'test-signature',
        mockPayment,
        mockValidateParams,
        mockReferencePublicKey
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Reference key not found in SOL transaction');
    });

    it('should handle amount validation failure', async () => {
      const mockTransaction = {
        meta: { err: null },
        transaction: {
          message: { version: 'legacy' }
        }
      };

      const mockAccountKeys = [
        { equals: jest.fn().mockReturnValue(true) }
      ];

      mockConnection.getTransaction.mockResolvedValue(mockTransaction);
      paymentMonitor.getTransactionAccountKeys.mockReturnValue(mockAccountKeys);
      paymentMonitor.validateSOLTransactionReference.mockReturnValue({
        isValid: true,
        details: { validationMethod: 'account-based' }
      });
      paymentMonitor.validateSOLAmount.mockReturnValue({
        isValid: false,
        error: 'Amount validation failed'
      });

      const result = await paymentMonitor.validateSOLPayment(
        mockConnection,
        'test-signature',
        mockPayment,
        mockValidateParams,
        mockReferencePublicKey
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Amount validation failed');
    });
  });

  describe('Error Handling and Retry Logic', () => {
    describe('categorizeErrorSeverity', () => {
      it('should categorize critical errors correctly', () => {
        expect(paymentMonitor.categorizeErrorSeverity('RPC_CONNECTION_FAILED')).toBe('critical');
        expect(paymentMonitor.categorizeErrorSeverity('DATABASE_ERROR')).toBe('critical');
        expect(paymentMonitor.categorizeErrorSeverity('NETWORK_TIMEOUT')).toBe('critical');
      });

      it('should categorize high severity errors correctly', () => {
        expect(paymentMonitor.categorizeErrorSeverity('TRANSACTION_FAILED')).toBe('high');
        expect(paymentMonitor.categorizeErrorSeverity('AMOUNT_TOO_LOW')).toBe('high');
        expect(paymentMonitor.categorizeErrorSeverity('RECIPIENT_NOT_FOUND')).toBe('high');
        expect(paymentMonitor.categorizeErrorSeverity('REFERENCE_NOT_FOUND')).toBe('high');
      });

      it('should categorize medium severity errors correctly', () => {
        expect(paymentMonitor.categorizeErrorSeverity('RPC_ERROR')).toBe('medium');
        expect(paymentMonitor.categorizeErrorSeverity('TRANSACTION_NOT_FOUND')).toBe('medium');
        expect(paymentMonitor.categorizeErrorSeverity('MISSING_BALANCE_METADATA')).toBe('medium');
      });

      it('should default to medium for unknown error types', () => {
        expect(paymentMonitor.categorizeErrorSeverity('UNKNOWN_ERROR')).toBe('medium');
      });
    });

    describe('isRetryableError', () => {
      it('should identify retryable errors correctly', () => {
        expect(paymentMonitor.isRetryableError('RPC_ERROR')).toBe(true);
        expect(paymentMonitor.isRetryableError('RPC_CONNECTION_FAILED')).toBe(true);
        expect(paymentMonitor.isRetryableError('NETWORK_TIMEOUT')).toBe(true);
        expect(paymentMonitor.isRetryableError('TRANSACTION_NOT_FOUND')).toBe(true);
      });

      it('should identify non-retryable errors correctly', () => {
        expect(paymentMonitor.isRetryableError('AMOUNT_TOO_LOW')).toBe(false);
        expect(paymentMonitor.isRetryableError('RECIPIENT_NOT_FOUND')).toBe(false);
        expect(paymentMonitor.isRetryableError('REFERENCE_NOT_FOUND')).toBe(false);
      });

      it('should handle retryable RPC error codes', () => {
        expect(paymentMonitor.isRetryableError('RPC_ERROR', { rpcErrorCode: -32603 })).toBe(true);
        expect(paymentMonitor.isRetryableError('RPC_ERROR', { rpcErrorCode: 429 })).toBe(true);
        expect(paymentMonitor.isRetryableError('RPC_ERROR', { rpcErrorCode: 503 })).toBe(true);
      });
    });

    describe('categorizeErrorType', () => {
      it('should categorize network errors correctly', () => {
        const connRefusedError = { code: 'ECONNREFUSED', message: 'Connection refused' };
        expect(paymentMonitor.categorizeErrorType(connRefusedError)).toBe('RPC_CONNECTION_FAILED');

        const timeoutError = { code: 'ETIMEDOUT', message: 'Timeout' };
        expect(paymentMonitor.categorizeErrorType(timeoutError)).toBe('NETWORK_TIMEOUT');

        const rpcError = { code: -32603, message: 'Internal error' };
        expect(paymentMonitor.categorizeErrorType(rpcError)).toBe('RPC_ERROR');
      });

      it('should categorize validation errors by message content', () => {
        const accountKeysError = { message: 'account keys not found' };
        expect(paymentMonitor.categorizeErrorType(accountKeysError)).toBe('ACCOUNT_KEYS_ERROR');

        const amountError = { message: 'amount too low: expected 100' };
        expect(paymentMonitor.categorizeErrorType(amountError)).toBe('AMOUNT_TOO_LOW');

        const recipientError = { message: 'recipient not found in transaction' };
        expect(paymentMonitor.categorizeErrorType(recipientError)).toBe('RECIPIENT_NOT_FOUND');
      });

      it('should handle FindReferenceError', () => {
        const findRefError = new (require('@solana/pay').FindReferenceError)();
        expect(paymentMonitor.categorizeErrorType(findRefError)).toBe('TRANSACTION_NOT_FOUND');

        const notFoundError = { message: 'not found' };
        expect(paymentMonitor.categorizeErrorType(notFoundError)).toBe('TRANSACTION_NOT_FOUND');
      });
    });

    describe('createStructuredError with enhanced fields', () => {
      const mockPayment = {
        reference: 'test-ref',
        amount: '1.0',
        currency: 'SOL',
        spl_token_mint: null
      };

      it('should include severity and retryable fields', () => {
        const error = paymentMonitor.createStructuredError(
          'RPC_ERROR',
          'Test RPC error',
          mockPayment,
          { type: 'SOL', currency: 'SOL', tokenMint: null, description: 'Native SOL Transfer' },
          { rpcErrorCode: -32603 }
        );

        expect(error.severity).toBe('medium');
        expect(error.isRetryable).toBe(true);
        expect(error.errorType).toBe('RPC_ERROR');
        expect(error.message).toBe('Test RPC error');
        expect(error.paymentContext.paymentType).toBe('SOL');
      });

      it('should handle high severity non-retryable errors', () => {
        const error = paymentMonitor.createStructuredError(
          'AMOUNT_TOO_LOW',
          'Amount validation failed',
          mockPayment,
          { type: 'SOL', currency: 'SOL', tokenMint: null, description: 'Native SOL Transfer' }
        );

        expect(error.severity).toBe('high');
        expect(error.isRetryable).toBe(false);
      });
    });
  });
});