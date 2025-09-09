-- Add user payment tracking table for BIP-39 deterministic addresses
CREATE TABLE IF NOT EXISTS user_payment_tracking (
    id SERIAL PRIMARY KEY,
    web3auth_user_id VARCHAR(255) NOT NULL UNIQUE,
    payment_counter INTEGER DEFAULT 0,
    master_seed_hash TEXT NOT NULL,
    total_payments INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast user lookups
CREATE INDEX IF NOT EXISTS idx_user_payment_tracking_user_id ON user_payment_tracking(web3auth_user_id);

-- Add payment_counter column to payments table for tracking
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_counter INTEGER;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS derivation_path VARCHAR(255);

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_user_payment_tracking_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_payment_tracking_updated_at
    BEFORE UPDATE ON user_payment_tracking
    FOR EACH ROW
    EXECUTE FUNCTION update_user_payment_tracking_updated_at();
