const validatePaymentRequest = (body) => {
    const { amount, label, message, memo } = body;
    const errors = [];
    
    if (!amount || isNaN(amount) || amount <= 0) {
        errors.push('Amount must be a positive number');
    }
    if (!label || typeof label !== 'string') {
        errors.push('Label is required and must be a string');
    }
    if (!message || typeof message !== 'string') {
        errors.push('Message is required and must be a string');
    }
    if (!memo || typeof memo !== 'string') {
        errors.push('Memo is required and must be a string');
    }
    
    return errors;
};

module.exports = { validatePaymentRequest };
