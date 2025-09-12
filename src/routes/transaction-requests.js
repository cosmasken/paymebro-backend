const express = require('express');
const router = express.Router();
const { getTransactionRequest, createTransaction } = require('../controllers/payments');
const { transactionRequestLimiter } = require('../middleware/rateLimiting');

// GET transaction request - returns transaction details
router.get('/:reference', transactionRequestLimiter, getTransactionRequest);

// POST transaction request - creates and returns transaction
router.post('/:reference', transactionRequestLimiter, createTransaction);

module.exports = router;
