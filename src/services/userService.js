/**
 * User Service
 * 
 * Centralized service for user-related operations including:
 * - Plan management
 * - Payment limits and tracking
 * - User data retrieval
 * 
 * This service consolidates user-related functions that were duplicated
 * across multiple services.
 * 
 * @module userService
 */

const database = require('./database');
const logger = require('../utils/logger');

class UserService {
    /**
     * Get user's plan type
     * 
     * @param {string} userId - Web3Auth user ID
     * @returns {Promise<string>} User's plan type (free, basic, premium, enterprise)
     */
    async getUserPlan(userId) {
        try {
            const { data } = await database.getClient()
                .from('users')
                .select('plan_type')
                .eq('web3auth_user_id', userId)
                .single();

            return data?.plan_type || 'free';
        } catch (error) {
            logger.error('Error fetching user plan', { userId, error: error.message });
            return 'free';
        }
    }

    /**
     * Get monthly payment count for user
     * 
     * @param {string} userId - Web3Auth user ID
     * @returns {Promise<number>} Number of payments created this month
     */
    async getMonthlyPaymentCount(userId) {
        try {
            const startOfMonth = new Date();
            startOfMonth.setDate(1);
            startOfMonth.setHours(0, 0, 0, 0);

            const { count } = await database.getClient()
                .from('payments')
                .select('*', { count: 'exact', head: true })
                .eq('web3auth_user_id', userId)
                .gte('created_at', startOfMonth.toISOString());

            return count || 0;
        } catch (error) {
            logger.error('Error fetching monthly payment count', { userId, error: error.message });
            return 0;
        }
    }

    /**
     * Check if user can create payment based on plan limits
     * 
     * @param {string} userId - Web3Auth user ID
     * @param {string|null} userPlan - Optional pre-fetched user plan
     * @returns {Promise<boolean>} Whether user can create more payments
     */
    async canUserCreatePayment(userId, userPlan = null) {
        try {
            const plan = userPlan || await this.getUserPlan(userId);
            const monthlyCount = await this.getMonthlyPaymentCount(userId);

            const limits = {
                free: 10,
                basic: 100,
                premium: 1000,
                enterprise: Infinity
            };

            return monthlyCount < (limits[plan] || limits.free);
        } catch (error) {
            logger.error('Error checking payment creation limits', { userId, error: error.message });
            return true; // Allow on error to prevent blocking users
        }
    }

    /**
     * Get plan limits for display purposes
     * 
     * @param {string} planType - Plan type
     * @returns {Object} Plan limits information
     */
    getPlanLimits(planType = 'free') {
        const limits = {
            free: { payments: 10, features: ['Basic payments', 'QR codes'] },
            basic: { payments: 100, features: ['Basic payments', 'QR codes', 'Email notifications'] },
            premium: { payments: 1000, features: ['All basic features', 'Custom branding', 'Analytics'] },
            enterprise: { payments: Infinity, features: ['All features', 'Priority support', 'Custom integrations'] }
        };

        return limits[planType] || limits.free;
    }

    /**
     * Get user statistics
     * 
     * @param {string} userId - Web3Auth user ID
     * @returns {Promise<Object>} User statistics
     */
    async getUserStats(userId) {
        try {
            const [plan, monthlyCount] = await Promise.all([
                this.getUserPlan(userId),
                this.getMonthlyPaymentCount(userId)
            ]);

            const planLimits = this.getPlanLimits(plan);
            const canCreatePayment = await this.canUserCreatePayment(userId, plan);

            return {
                plan,
                monthlyPayments: monthlyCount,
                monthlyLimit: planLimits.payments,
                canCreatePayment,
                remainingPayments: planLimits.payments === Infinity
                    ? Infinity
                    : Math.max(0, planLimits.payments - monthlyCount)
            };
        } catch (error) {
            logger.error('Error fetching user stats', { userId, error: error.message });
            return {
                plan: 'free',
                monthlyPayments: 0,
                monthlyLimit: 10,
                canCreatePayment: true,
                remainingPayments: 10
            };
        }
    }
}

module.exports = new UserService();