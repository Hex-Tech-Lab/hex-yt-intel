-- Stripe integration migration
-- Add missing stripe_customer_id and stripe_subscription_id columns if they don't exist

-- Check and add columns to users table
DO $$
BEGIN
  -- Add stripe_customer_id if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'stripe_customer_id'
  ) THEN
    ALTER TABLE users ADD COLUMN stripe_customer_id TEXT UNIQUE;
  END IF;

  -- Add stripe_subscription_id if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'stripe_subscription_id'
  ) THEN
    ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;
  END IF;

  -- Add analyses_used if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'analyses_used'
  ) THEN
    ALTER TABLE users ADD COLUMN analyses_used INT DEFAULT 0;
  END IF;

  -- Add last_reset_date if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'last_reset_date'
  ) THEN
    ALTER TABLE users ADD COLUMN last_reset_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  END IF;
END $$;

-- Create indexes for Stripe fields
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription_id ON users(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_users_tier ON users(tier);

-- Add comment documenting the stripe integration
COMMENT ON TABLE stripe_events IS 'Webhook events from Stripe for audit trail and debugging';
COMMENT ON COLUMN stripe_events.id IS 'Stripe event ID (stripe_event_id_xyz)';
COMMENT ON COLUMN stripe_events.user_id IS 'User ID associated with the event (can be NULL)';
COMMENT ON COLUMN stripe_events.event_type IS 'Type of Stripe event (customer.subscription.created, etc)';
COMMENT ON COLUMN stripe_events.status IS 'Processing status (success, failed, pending)';
