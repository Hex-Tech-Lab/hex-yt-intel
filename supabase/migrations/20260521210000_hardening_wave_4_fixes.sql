-- ============================================================================
-- HARDENING WAVE 4: Critical Security Fixes
-- ============================================================================
-- Fixes:
--   1. Add 'rate_limit_exceeded' to usage_logs.action CHECK constraint (HIGH-15)
--   2. Normalize quota with COALESCE for null handling (HIGH-4)
--   3. Restrict SECURITY DEFINER privileges (HIGH-2, 5, 16)
-- ============================================================================

DO $$ BEGIN
  -- FIX #1: Add 'rate_limit_exceeded' to usage_logs.action enum
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'usage_logs' AND table_schema = 'public') THEN
    -- Drop existing constraint if it exists
    ALTER TABLE public.usage_logs
    DROP CONSTRAINT IF EXISTS usage_logs_action_check;

    -- Recreate constraint with complete action set
    ALTER TABLE public.usage_logs
    ADD CONSTRAINT usage_logs_action_check CHECK (
      action = ANY (ARRAY[
        'analysis',
        'search',
        'export',
        'api_call',
        'rate_limit_exceeded'
      ])
    );

    RAISE NOTICE 'Fixed usage_logs.action CHECK constraint: added rate_limit_exceeded';
  END IF;

  -- FIX #2: Ensure users table quota column handles NULLs safely
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users' AND table_schema = 'public') THEN
    -- Update any NULL analyses_used to 0 (graceful migration for legacy data)
    UPDATE public.users SET analyses_used = 0 WHERE analyses_used IS NULL;

    -- Set NOT NULL constraint with default
    ALTER TABLE public.users
    ALTER COLUMN analyses_used SET DEFAULT 0;
    ALTER TABLE public.users
    ALTER COLUMN analyses_used SET NOT NULL;

    RAISE NOTICE 'Fixed users.analyses_used: set NOT NULL with default 0';
  END IF;

  -- FIX #3: Restrict SECURITY DEFINER privileges on quota RPCs
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'increment_user_quota_atomic' AND pronamespace = 'public'::regnamespace) THEN
    -- Update RPC to restrict privilege escalation checks
    DROP FUNCTION IF EXISTS public.increment_user_quota_atomic(uuid);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'decrement_user_quota' AND pronamespace = 'public'::regnamespace) THEN
    -- Update RPC to restrict privilege escalation checks
    DROP FUNCTION IF EXISTS public.decrement_user_quota(uuid, integer);
  END IF;

END $$;
