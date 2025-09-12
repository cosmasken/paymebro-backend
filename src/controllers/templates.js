const database = require('../services/database');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

/**
 * Create payment template
 */
const createTemplate = asyncHandler(async (req, res) => {
  const { name, amount, currency, label, message, splToken, web3AuthUserId } = req.body;

  try {
    const { data: template, error } = await database.getClient()
      .from('payment_templates')
      .insert({
        name,
        amount: parseFloat(amount),
        currency: currency || 'USDC',
        label,
        message,
        spl_token_mint: splToken,
        web3auth_user_id: web3AuthUserId, // This should be TEXT, not UUID
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      logger.error('Template creation error', { error: error.message });
      throw error;
    }

    res.json({ success: true, data: template });
  } catch (error) {
    logger.error('Failed to create template', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to create template',
      details: error.message
    });
  }
});

/**
 * Get user's templates
 */
const getUserTemplates = asyncHandler(async (req, res) => {
  const { web3AuthUserId } = req.params;

  const { data: templates } = await database.getClient()
    .from('payment_templates')
    .select('*')
    .eq('web3auth_user_id', web3AuthUserId)
    .order('created_at', { ascending: false });

  let userTemplates = templates || [];

  // If user has no templates, provide default templates
  if (userTemplates.length === 0) {
    const defaultTemplates = [
      {
        id: 'default-coffee',
        name: 'Coffee Shop Payment',
        amount: 5.00,
        currency: 'USDC',
        label: 'Coffee Purchase',
        message: 'Thank you for your order!',
        web3auth_user_id: web3AuthUserId,
        created_at: new Date().toISOString(),
        isDefault: true
      },
      {
        id: 'default-service',
        name: 'Service Payment',
        amount: 25.00,
        currency: 'USDC',
        label: 'Service Fee',
        message: 'Payment for services rendered',
        web3auth_user_id: web3AuthUserId,
        created_at: new Date().toISOString(),
        isDefault: true
      }
    ];
    userTemplates = defaultTemplates;
  }

  res.json({ success: true, templates: userTemplates });
});

/**
 * Update template
 */
const updateTemplate = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, amount, currency, label, message, splToken } = req.body;

  const { data: template, error } = await database.getClient()
    .from('payment_templates')
    .update({
      name,
      amount,
      currency,
      label,
      message,
      spl_token_mint: splToken,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;

  res.json({ success: true, template });
});

/**
 * Delete template
 */
const deleteTemplate = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { error } = await database.getClient()
    .from('payment_templates')
    .delete()
    .eq('id', id);

  if (error) throw error;

  res.json({ success: true, message: 'Template deleted' });
});

/**
 * Create payment from template
 */
const createPaymentFromTemplate = asyncHandler(async (req, res) => {
  const { templateId } = req.params;
  const { customerEmail } = req.body;

  let template;

  // Handle default templates
  if (templateId.startsWith('default-')) {
    const defaultTemplates = {
      'default-coffee': {
        amount: 5.00,
        label: 'Coffee Purchase',
        message: 'Thank you for your order!',
        currency: 'USDC',
        web3auth_user_id: req.headers['x-user-id']
      },
      'default-service': {
        amount: 25.00,
        label: 'Service Fee',
        message: 'Payment for services rendered',
        currency: 'USDC',
        web3auth_user_id: req.headers['x-user-id']
      }
    };
    template = defaultTemplates[templateId];
  } else {
    // Get template from database
    const { data: dbTemplate } = await database.getClient()
      .from('payment_templates')
      .select('*')
      .eq('id', templateId)
      .single();
    template = dbTemplate;
  }

  if (!template) {
    return res.status(404).json({
      success: false,
      error: 'Template not found'
    });
  }

  // Create payment using template data
  const paymentData = {
    amount: template.amount,
    label: template.label,
    message: template.message,
    customerEmail,
    web3AuthUserId: template.web3auth_user_id,
    splToken: template.spl_token_mint,
    currency: template.currency
  };

  // Use existing payment creation logic
  const PaymentController = require('./payments');
  req.body = paymentData;

  // Call payment creation which will handle email notifications
  return PaymentController.createPayment(req, res);
});

module.exports = {
  createTemplate,
  getUserTemplates,
  updateTemplate,
  deleteTemplate,
  createPaymentFromTemplate
};
