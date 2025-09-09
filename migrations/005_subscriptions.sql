-- Create subscription_plans table
CREATE TABLE IF NOT EXISTS subscription_plans (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    web3auth_user_id TEXT NOT NULL,
    name VARCHAR(255) NOT NULL,
    amount DECIMAL(20, 9) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'USDC',
    interval_type VARCHAR(20) NOT NULL DEFAULT 'monthly',
    interval_count INTEGER DEFAULT 1,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    web3auth_user_id TEXT NOT NULL,
    plan_id UUID NOT NULL,
    customer_email VARCHAR(255) NOT NULL,
    wallet_address VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'active',
    current_period_start TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    current_period_end TIMESTAMP WITH TIME ZONE,
    next_payment_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_subscription_plans_user_id ON subscription_plans(web3auth_user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(web3auth_user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_id ON subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
