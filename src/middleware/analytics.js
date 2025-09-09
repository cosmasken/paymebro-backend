const database = require('../services/database');
const logger = require('../utils/logger');

/**
 * Update payment analytics (consolidated function)
 */
async function updatePaymentAnalytics(paymentId) {
  try {
    const { data: analytics } = await database.getClient()
      .from('payment_analytics')
      .select('*')
      .eq('payment_id', paymentId)
      .single();

    if (analytics) {
      await database.getClient()
        .from('payment_analytics')
        .update({ updated_at: new Date().toISOString() })
        .eq('payment_id', paymentId);
    } else {
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
  } catch (error) {
    logger.error('Payment analytics update failed:', { paymentId, error: error.message });
  }
}

/**
 * Track payment link visits
 */
const trackLinkVisit = async (req, res, next) => {
  try {
    const { reference } = req.params;
    
    const payment = await database.getPayment(reference);

    if (payment) {
      await database.getClient().from('link_visits').insert({
        payment_id: payment.id,
        ip_address: req.ip,
        user_agent: req.get('User-Agent'),
        referrer: req.get('Referer')
      });
      
      setImmediate(() => updatePaymentAnalytics(payment.id));
    }
  } catch (error) {
    logger.error('Analytics tracking error:', error);
  }
  next();
};

/**
 * Track QR code scans
 */
const trackQRScan = async (req, res, next) => {
  try {
    const { reference } = req.params;
    
    const payment = await database.getPayment(reference);

    if (payment) {
      await database.getClient().from('qr_scans').insert({
        payment_id: payment.id,
        ip_address: req.ip,
        user_agent: req.get('User-Agent'),
        scan_method: 'api'
      });
      
      setImmediate(() => updatePaymentAnalytics(payment.id));
    }
  } catch (error) {
    logger.error('QR scan tracking error:', error);
  }
  next();
};

module.exports = {
  trackLinkVisit,
  trackQRScan
};
