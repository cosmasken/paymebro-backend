-- Add plan_type column to users table for plan enforcement
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_type VARCHAR(20) DEFAULT 'free';

-- Create index for plan type queries
CREATE INDEX IF NOT EXISTS idx_users_plan_type ON users(plan_type);

-- Update existing users to free plan
UPDATE users SET plan_type = 'free' WHERE plan_type IS NULL;

-- Add constraint to ensure valid plan types
ALTER TABLE users ADD CONSTRAINT check_plan_type 
CHECK (plan_type IN ('free', 'pro', 'enterprise'));
