const { Resend } = require('resend');

class EmailService {
  constructor() {
    this.resend = null;
  }

  getClient() {
    if (!this.resend) {
      if (!process.env.RESEND_API_KEY) {
        throw new Error('RESEND_API_KEY environment variable is required');
      }
      this.resend = new Resend(process.env.RESEND_API_KEY);
    }
    return this.resend;
  }

  async sendPaymentCreatedEmail(payment, customerEmail) {
    if (!customerEmail || !process.env.RESEND_API_KEY) return;

    const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payment Request</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
        <div style="max-width: 600px; margin: 2rem auto; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 2rem; text-align: center;">
                <h1 style="margin: 0; font-size: 1.8rem;">💳 Payment Request</h1>
                <div style="background: rgba(255,255,255,0.2); padding: 0.5rem 1rem; border-radius: 20px; font-size: 0.9rem; font-weight: bold; margin-top: 1rem; display: inline-block;">
                    Action Required
                </div>
            </div>
            
            <div style="padding: 2rem;">
                <div style="font-size: 2.5rem; font-weight: bold; color: #333; margin: 1rem 0; text-align: center;">
                    ${payment.amount} ${payment.currency || 'SOL'}
                </div>
                
                <div style="background: #f8f9fa; padding: 1.5rem; border-radius: 8px; margin: 1rem 0;">
                    <div style="display: flex; justify-content: space-between; margin: 0.5rem 0; align-items: center;">
                        <span style="color: #666;">Description:</span>
                        <span style="font-weight: 500;">${payment.message}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin: 0.5rem 0; align-items: center;">
                        <span style="color: #666;">Label:</span>
                        <span style="font-weight: 500;">${payment.label}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin: 0.5rem 0; align-items: center;">
                        <span style="color: #666;">Network:</span>
                        <span style="font-weight: 500; text-transform: capitalize;">${payment.chain}</span>
                    </div>
                </div>

                <div style="text-align: center; margin: 2rem 0;">
                    <a href="${payment.paymentUrl}" style="display: inline-block; background: #14F195; color: #000; padding: 1rem 2rem; border-radius: 8px; text-decoration: none; font-weight: bold; margin: 1rem 0;">
                        🚀 Pay Now
                    </a>
                    <p style="margin-top: 1rem; font-size: 0.9rem; color: #666;">
                        Click to open payment page with QR code
                    </p>
                </div>
            </div>

            <div style="text-align: center; padding: 1rem; color: #666; font-size: 0.9rem; border-top: 1px solid #eee;">
                <p style="margin: 0;">Powered by PayMeBro • Secure Solana Payments</p>
            </div>
        </div>
    </body>
    </html>`;

    try {
      const { data, error } = await this.getClient().emails.send({
        from: process.env.FROM_EMAIL || 'payments@payments.paymebro.xyz',
        to: [customerEmail],
        subject: 'Payment Request - Action Required',
        html: emailHtml
      });

      if (error) {
        throw new Error(error.message);
      }

      return data;
    } catch (error) {
      console.error('Email sending failed:', error);
      throw error;
    }
  }

  async sendPaymentConfirmedEmail(payment, customerEmail) {
    if (!customerEmail || !process.env.RESEND_API_KEY) return;

    const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payment Confirmed</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
        <div style="max-width: 600px; margin: 2rem auto; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #14F195 0%, #00D084 100%); color: #000; padding: 2rem; text-align: center;">
                <h1 style="margin: 0; font-size: 1.8rem;">✅ Payment Confirmed</h1>
                <div style="background: rgba(0,0,0,0.1); padding: 0.5rem 1rem; border-radius: 20px; font-size: 0.9rem; font-weight: bold; margin-top: 1rem; display: inline-block;">
                    Successfully Processed
                </div>
            </div>
            
            <div style="padding: 2rem;">
                <div style="font-size: 2.5rem; font-weight: bold; color: #333; margin: 1rem 0; text-align: center;">
                    ${payment.amount} ${payment.currency || 'SOL'}
                </div>
                
                <div style="background: #f8f9fa; padding: 1.5rem; border-radius: 8px; margin: 1rem 0;">
                    <div style="display: flex; justify-content: space-between; margin: 0.5rem 0; align-items: center;">
                        <span style="color: #666;">Description:</span>
                        <span style="font-weight: 500;">${payment.message}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin: 0.5rem 0; align-items: center;">
                        <span style="color: #666;">Transaction:</span>
                        <span style="font-weight: 500; font-family: monospace; font-size: 0.8rem;">${payment.transaction_signature}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin: 0.5rem 0; align-items: center;">
                        <span style="color: #666;">Network:</span>
                        <span style="font-weight: 500; text-transform: capitalize;">${payment.chain}</span>
                    </div>
                </div>

                <div style="text-align: center; margin: 2rem 0; padding: 1.5rem; background: #d1edff; border-radius: 8px;">
                    <h3 style="margin: 0 0 0.5rem 0; color: #0c5460;">Thank you for your payment!</h3>
                    <p style="margin: 0; color: #0c5460;">Your transaction has been successfully processed and confirmed on the blockchain.</p>
                </div>
            </div>

            <div style="text-align: center; padding: 1rem; color: #666; font-size: 0.9rem; border-top: 1px solid #eee;">
                <p style="margin: 0;">Powered by PayMeBro • Secure Solana Payments</p>
            </div>
        </div>
    </body>
    </html>`;

    try {
      const { data, error } = await this.getClient().emails.send({
        from: process.env.FROM_EMAIL || 'payments@payments.paymebro.xyz',
        to: [customerEmail],
        subject: 'Payment Confirmed - Thank You!',
        html: emailHtml
      });

      if (error) {
        throw new Error(error.message);
      }

      return data;
    } catch (error) {
      console.error('Email sending failed:', error);
      throw error;
    }
  }

  async sendPaymentInvoice(payment, customerEmail, baseUrl) {
    if (!customerEmail || !process.env.RESEND_API_KEY) return;

    const paymentUrl = `${baseUrl}/payment/${payment.reference}`;
    
    try {
      const { data, error } = await this.getClient().emails.send({
        from: process.env.FROM_EMAIL || 'payments@payments.paymebro.xyz',
        to: [customerEmail],
        subject: 'Payment Invoice',
        html: `
          <h2>Payment Invoice</h2>
          <p><strong>Amount:</strong> ${payment.amount} ${payment.currency || 'SOL'}</p>
          <p><strong>Message:</strong> ${payment.message}</p>
          <p><strong>Label:</strong> ${payment.label}</p>
          <p><a href="${paymentUrl}" style="background: #007cba; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Pay Now</a></p>
        `
      });

      if (error) {
        throw new Error(error.message);
      }

      return data;
    } catch (error) {
      console.error('Email sending failed:', error);
      throw error;
    }
  }
}

module.exports = new EmailService();
