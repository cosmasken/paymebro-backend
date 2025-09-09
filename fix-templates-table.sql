-- Fix payment_templates table to use TEXT for web3auth_user_id
-- Run this in Supabase SQL Editor

-- First, drop the existing table if it's empty
DROP TABLE IF EXISTS payment_templates;

-- Recreate with correct column types
CREATE TABLE payment_templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    web3auth_user_id TEXT NOT NULL,
    name VARCHAR(255) NOT NULL,
    amount DECIMAL(20, 9) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'USDC',
    label VARCHAR(255),
    message TEXT,
    spl_token_mint VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster user template queries
CREATE INDEX IF NOT EXISTS idx_payment_templates_user_id ON payment_templates(web3auth_user_id);

-- Enable RLS
ALTER TABLE payment_templates ENABLE ROW LEVEL SECURITY;

-- Create RLS policy
CREATE POLICY "Users can manage their own templates" ON payment_templates
    FOR ALL USING (web3auth_user_id = current_setting('request.jwt.claims', true)::json->>'sub');
