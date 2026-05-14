-- Add sharing columns to analyses table
ALTER TABLE analyses 
ADD COLUMN IF NOT EXISTS shared_token varchar(64) unique,
ADD COLUMN IF NOT EXISTS shared_expires_at timestamp with time zone;

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_analyses_shared_token ON analyses(shared_token);
