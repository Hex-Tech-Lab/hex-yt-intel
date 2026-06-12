-- Migration: Add billing_status column to analyses table for transaction outbox quota enforcement
-- Consolidates quota checking and charging onto the analyses table as the single source of truth.

ALTER TABLE public.analyses ADD COLUMN IF NOT EXISTS billing_status text DEFAULT 'processing';

-- Backfill billing_status based on validation_passed for existing rows
UPDATE public.analyses
SET billing_status = CASE WHEN validation_passed = true THEN 'completed' ELSE 'failed' END;

-- Enforce constraints
ALTER TABLE public.analyses ALTER COLUMN billing_status SET NOT NULL;
ALTER TABLE public.analyses DROP CONSTRAINT IF EXISTS check_billing_status;
ALTER TABLE public.analyses ADD CONSTRAINT check_billing_status CHECK (billing_status IN ('processing', 'completed', 'failed'));

-- Index to optimize monthly quota queries
CREATE INDEX IF NOT EXISTS analyses_quota_idx ON public.analyses(user_id, billing_status, created_at);
