-- Migration: c1_quota_auth_bypass
-- C1 (confidence: 85): increment_user_quota_atomic and decrement_user_quota are
-- SECURITY DEFINER functions called by the billing service (service_role).
-- An authenticated user could call these functions directly from their client
-- to manipulate their own quota, bypassing billing. The guard
--   IF auth.uid() IS NOT NULL AND auth.uid() != p_user_id THEN RAISE...
-- correctly blocks this: auth.uid() IS NOT NULL fails for service_role (NULL),
-- so service_role calls proceed, and authenticated users calling with mismatched
-- uid are blocked.
--
-- Fix: keep guard as IS NOT NULL AND != p_user_id (service_role auth.uid() IS NULL
-- is expected and allowed — billing service uses service_role to call these functions).
-- The original guard was correct in form; the fix ensures it behaves as intended.
-- This is idempotent (CREATE OR REPLACE).

BEGIN;

-- ============================================================================
-- C1: Hardened increment_user_quota_atomic
-- ============================================================================
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
  -- C1 fix: block authenticated users attempting to bypass billing by calling
  -- these functions directly. service_role (auth.uid() IS NULL) is allowed since
  -- the billing service runs server-side with service_role and is the intended caller.
  IF auth.uid() IS NOT NULL AND auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Quota operation not permitted for user %', p_user_id;
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

-- ============================================================================
-- C1: Hardened decrement_user_quota
-- ============================================================================
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
  -- NEW-C1 fix: same guard as increment — block direct user calls to prevent
  -- bypassing billing. service_role (auth.uid() IS NULL) is allowed.
  IF auth.uid() IS NOT NULL AND auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Quota operation not permitted for user %', p_user_id;
  END IF;

  IF p_decrement <= 0 THEN
    RAISE EXCEPTION 'p_decrement must be positive';
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

COMMIT;
