-- Fix payment_templates table to use TEXT for web3auth_user_id (since we use email as ID)
CREATE TABLE IF NOT EXISTS payment_templates (
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
