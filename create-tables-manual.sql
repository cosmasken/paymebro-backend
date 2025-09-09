-- Manual table creation script for Supabase
-- Run these commands in the Supabase SQL Editor

-- 1. Create subscription_plans table
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

-- 2. Create subscriptions table
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

-- 3. Create webhooks table
CREATE TABLE IF NOT EXISTS webhooks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    web3auth_user_id TEXT NOT NULL,
    url VARCHAR(500) NOT NULL,
    events TEXT[] NOT NULL,
    secret VARCHAR(255),
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Create email_notifications table
CREATE TABLE IF NOT EXISTS email_notifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    web3auth_user_id TEXT NOT NULL,
    email VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    sent_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_subscription_plans_user_id ON subscription_plans(web3auth_user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(web3auth_user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_id ON subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_webhooks_user_id ON webhooks(web3auth_user_id);
CREATE INDEX IF NOT EXISTS idx_email_notifications_user_id ON email_notifications(web3auth_user_id);
CREATE INDEX IF NOT EXISTS idx_email_notifications_status ON email_notifications(status);
CREATE INDEX IF NOT EXISTS idx_email_notifications_type ON email_notifications(type);

-- 6. Enable Row Level Security (RLS) for all tables
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_notifications ENABLE ROW LEVEL SECURITY;

-- 7. Create RLS policies (users can only access their own data)
CREATE POLICY "Users can view their own subscription plans" ON subscription_plans
    FOR SELECT USING (web3auth_user_id = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY "Users can insert their own subscription plans" ON subscription_plans
    FOR INSERT WITH CHECK (web3auth_user_id = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY "Users can update their own subscription plans" ON subscription_plans
    FOR UPDATE USING (web3auth_user_id = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY "Users can delete their own subscription plans" ON subscription_plans
    FOR DELETE USING (web3auth_user_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- Similar policies for other tables
CREATE POLICY "Users can view their own subscriptions" ON subscriptions
    FOR SELECT USING (web3auth_user_id = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY "Users can view their own webhooks" ON webhooks
    FOR SELECT USING (web3auth_user_id = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY "Users can view their own email notifications" ON email_notifications
    FOR SELECT USING (web3auth_user_id = current_setting('request.jwt.claims', true)::json->>'sub');
