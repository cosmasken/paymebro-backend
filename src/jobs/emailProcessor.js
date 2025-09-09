require('dotenv').config();
const emailService = require('../services/emailService');
const logger = require('../utils/logger');

/**
 * Process pending emails - run this every 5 minutes
 */
async function processEmails() {
  try {
    logger.info('Starting email processing job...');
    
    const processedCount = await emailService.processPendingEmails();
    
    if (processedCount > 0) {
      logger.info(`Email processing completed: ${processedCount} emails processed`);
    }
    
    return processedCount;
  } catch (error) {
    logger.error('Email processing job failed:', error);
    throw error;
  }
}

// Export for manual execution or cron setup
module.exports = {
  processEmails
};

// If running directly, process emails once
if (require.main === module) {
  processEmails()
    .then(count => {
      console.log(`✅ Processed ${count} emails`);
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Email processing failed:', error);
      process.exit(1);
    });
}
