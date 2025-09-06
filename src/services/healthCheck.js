const database = require('./database');
const logger = require('../utils/logger');

/**
 * Health check service for monitoring system status
 */
class HealthCheckService {
  /**
   * Perform comprehensive health check
   */
  async checkHealth() {
    const checks = {
      timestamp: new Date().toISOString(),
      status: 'healthy',
      version: process.env.npm_package_version || '1.0.0',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      checks: {}
    };

    // Database connectivity check
    try {
      await database.getClient().from('users').select('count').limit(1);
      checks.checks.database = { status: 'healthy', responseTime: Date.now() };
    } catch (error) {
      checks.checks.database = { status: 'unhealthy', error: error.message };
      checks.status = 'unhealthy';
    }

    // Environment variables check
    const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'RESEND_API_KEY'];
    const missingEnvVars = requiredEnvVars.filter(env => !process.env[env]);
    
    checks.checks.environment = {
      status: missingEnvVars.length === 0 ? 'healthy' : 'unhealthy',
      ...(missingEnvVars.length > 0 && { missingVars: missingEnvVars })
    };

    if (missingEnvVars.length > 0) {
      checks.status = 'unhealthy';
    }

    return checks;
  }

  /**
   * Simple readiness check
   */
  async checkReadiness() {
    try {
      await database.getClient().from('users').select('count').limit(1);
      return { status: 'ready', timestamp: new Date().toISOString() };
    } catch (error) {
      throw new Error('Service not ready');
    }
  }

  /**
   * Liveness check
   */
  checkLiveness() {
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    };
  }
}

module.exports = new HealthCheckService();
