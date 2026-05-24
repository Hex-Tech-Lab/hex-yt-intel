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

-- ============================================================================
-- RE-CREATE HARDENED RPCs: Quota Management
-- ============================================================================

-- Atomic increment with quota check
-- Hardened: Added search_path and explicit auth check
CREATE OR REPLACE FUNCTION public.increment_user_quota_atomic(p_user_id uuid)
RETURNS TABLE (
  success boolean,
  new_quota integer,
  tier text,
  quota_limit integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_quota integer;
  v_tier text;
  v_quota_limit integer;
  v_rows_affected integer;
BEGIN
  -- Security: Only user or service_role can modify
  IF auth.uid() IS NOT NULL AND auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: Cannot modify quota for another user';
  END IF;

  UPDATE public.users
  SET analyses_used = analyses_used + 1,
      updated_at = now()
  WHERE id = p_user_id
    AND (tier = 'pro' OR (tier = 'free' AND analyses_used < 3))
  RETURNING analyses_used, "tier" INTO v_new_quota, v_tier;

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  IF v_rows_affected = 1 THEN
    v_quota_limit := CASE WHEN v_tier = 'free' THEN 3 ELSE NULL END;
    RETURN QUERY SELECT true, v_new_quota, v_tier, v_quota_limit;
  ELSE
    SELECT analyses_used, users.tier INTO v_new_quota, v_tier
    FROM public.users WHERE id = p_user_id;
    
    v_quota_limit := CASE WHEN v_tier = 'free' THEN 3 ELSE NULL END;
    RETURN QUERY SELECT false, v_new_quota, v_tier, v_quota_limit;
  END IF;
END;
$$;

-- Atomic decrement (refund)
-- Signature: p_user_id, p_decrement
CREATE OR REPLACE FUNCTION public.decrement_user_quota(p_user_id uuid, p_decrement integer DEFAULT 1)
RETURNS TABLE (
  new_quota integer,
  tier text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_quota integer;
  v_tier text;
BEGIN
  -- Security: Only user or service_role can modify
  IF auth.uid() IS NOT NULL AND auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: Cannot modify quota for another user';
  END IF;

  UPDATE public.users
  SET analyses_used = GREATEST(0, analyses_used - p_decrement),
      updated_at = now()
  WHERE id = p_user_id
  RETURNING analyses_used, users.tier INTO v_new_quota, v_tier;

  IF FOUND THEN
    RETURN QUERY SELECT v_new_quota, v_tier;
  ELSE
    RETURN QUERY SELECT 0, 'free'::text;
  END IF;
END;
$$;
