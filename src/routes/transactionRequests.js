const express = require('express');
const router = express.Router();
const TransactionRequestController = require('../controllers/transactionRequests');

/**
 * GET /api/transaction-requests/:reference
 * Returns merchant info for wallet display
 */
router.get('/:reference', TransactionRequestController.getTransactionRequest);

/**
 * POST /api/transaction-requests/:reference  
 * Creates and returns transaction for wallet to sign
 */
router.post('/:reference', TransactionRequestController.createTransaction);

module.exports = router;
