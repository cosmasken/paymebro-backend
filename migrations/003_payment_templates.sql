-- Create payment_templates table
CREATE TABLE IF NOT EXISTS payment_templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    web3auth_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    amount DECIMAL(20, 9) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'SOL',
    label VARCHAR(255),
    message TEXT,
    spl_token_mint VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster user template queries
CREATE INDEX IF NOT EXISTS idx_payment_templates_user_id ON payment_templates(web3auth_user_id);

-- Add some example templates for demo
INSERT INTO payment_templates (web3auth_user_id, name, amount, currency, label, message) 
SELECT 
    id,
    'Coffee Payment',
    0.01,
    'SOL',
    '☕ Coffee Shop',
    'Thanks for your coffee purchase!'
FROM users 
LIMIT 1
ON CONFLICT DO NOTHING;
