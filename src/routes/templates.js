const express = require('express');
const router = express.Router();
const {
  createTemplate,
  getUserTemplates,
  updateTemplate,
  deleteTemplate,
  createPaymentFromTemplate
} = require('../controllers/templates');

/**
 * POST /api/templates
 * Create new payment template
 */
router.post('/', createTemplate);

/**
 * GET /api/templates/user/:web3AuthUserId
 * Get user's templates
 */
router.get('/user/:web3AuthUserId', getUserTemplates);

/**
 * PUT /api/templates/:id
 * Update template
 */
router.put('/:id', updateTemplate);

/**
 * DELETE /api/templates/:id
 * Delete template
 */
router.delete('/:id', deleteTemplate);

/**
 * POST /api/templates/:templateId/create-payment
 * Create payment from template
 */
router.post('/:templateId/create-payment', createPaymentFromTemplate);

module.exports = router;
