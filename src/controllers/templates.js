const database = require('../services/database');
const { asyncHandler } = require('../middleware/errorHandler');

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
      console.error('Template creation error:', error);
      throw error;
    }

    res.json({ success: true, data: template });
  } catch (error) {
    console.error('Failed to create template:', error);
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

  res.json({ success: true, templates: templates || [] });
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

  const { data: template } = await database.getClient()
    .from('payment_templates')
    .select('*')
    .eq('id', templateId)
    .single();

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
