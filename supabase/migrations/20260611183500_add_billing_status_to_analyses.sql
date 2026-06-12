-- Migration: Add billing_status column to analyses table for transaction outbox quota enforcement
-- Consolidates quota checking and charging onto the analyses table as the single source of truth.

ALTER TABLE public.analyses ADD COLUMN IF NOT EXISTS billing_status text DEFAULT 'processing';

-- Index to optimize monthly quota queries
CREATE INDEX IF NOT EXISTS analyses_quota_idx ON public.analyses(user_id, billing_status, created_at);
