-- Phase C: Epistemic Schism & Ghost Row Persistence Schema
-- Target: analyses table additive migration
-- Supports Layer 0 Sensor Fusion degradation tracking and Layer 2 Part A Grounded Extraction output.

-- 1. Add grounded_claims JSONB column (default '{}')
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS grounded_claims jsonb DEFAULT '{}'::jsonb;

-- 2. Add unknowns JSONB column (default '[]')
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS unknowns jsonb DEFAULT '[]'::jsonb;

-- 3. Add degraded_sensors BOOLEAN column (default false)
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS degraded_sensors boolean DEFAULT false;

-- 4. Safely widen check_billing_status constraint to include 'partial_extraction'
--    Checks for existing constraint and updates it idempotently.
DO $$
BEGIN
  -- If check_billing_status exists, update it to include 'partial_extraction'
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_billing_status'
      AND conrelid = 'public.analyses'::regclass
  ) THEN
    ALTER TABLE public.analyses DROP CONSTRAINT check_billing_status;
    ALTER TABLE public.analyses ADD CONSTRAINT check_billing_status
      CHECK (billing_status IN ('processing', 'completed', 'failed', 'cancelled', 'partial_extraction'));
  END IF;
END $$;

-- 5. If any custom ENUM type exists for analysis_status in PostgreSQL, safely append 'partial_extraction'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'analysis_status' AND n.nspname = 'public'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'analysis_status' AND e.enumlabel = 'partial_extraction'
    ) THEN
      ALTER TYPE public.analysis_status ADD VALUE 'partial_extraction';
    END IF;
  END IF;
END $$;

-- 6. Index for querying partial ghost rows pending Part B synthesis recovery
CREATE INDEX IF NOT EXISTS idx_analyses_partial_extraction
  ON public.analyses(user_id, billing_status)
  WHERE billing_status = 'partial_extraction';
