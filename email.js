import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendPaymentConfirmation = async (email, paymentData) => {
  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: email,
      subject: `Payment Confirmed - ${paymentData.amount} ${paymentData.currency}`,
      html: `
        <h2>Payment Confirmed</h2>
        <p>Amount: ${paymentData.amount} ${paymentData.currency}</p>
        <p>Reference: ${paymentData.reference}</p>
        <p>Status: ${paymentData.status}</p>
      `
    });
  } catch (error) {
    console.error('Email send failed:', error);
  }
};

export const sendInvoice = async (email, invoiceData) => {
  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: email,
      subject: `Invoice - ${invoiceData.amount} ${invoiceData.currency}`,
      html: `
        <h2>Invoice</h2>
        <p>Amount: ${invoiceData.amount} ${invoiceData.currency}</p>
        <p>Description: ${invoiceData.description}</p>
        <p>Pay: <a href="${invoiceData.paymentUrl}">Click here</a></p>
      `
    });
  } catch (error) {
    console.error('Invoice email failed:', error);
  }
};
