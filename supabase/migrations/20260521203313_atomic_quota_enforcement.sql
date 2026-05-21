-- Atomic quota enforcement: increment_user_quota_atomic
-- Prevents TOCTOU race: returns success only if user is under quota
-- Free tier: max 3 analyses/month
-- Pro tier: unlimited (always succeeds if user exists)

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
  -- Atomic compare-and-swap: increment if under quota
  -- Free tier (tier='free'): limit 3 analyses/month
  -- Pro tier (tier='pro'): unlimited (analyses_used < 999999)
  UPDATE public.users
  SET analyses_used = analyses_used + 1
  WHERE id = p_user_id
    AND (tier = 'pro' OR (tier = 'free' AND analyses_used < 3))
  RETURNING analyses_used, "tier" INTO v_new_quota, v_tier;

  -- Check if update succeeded (1 row affected) or failed (0 rows = quota exceeded)
  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  IF v_rows_affected = 1 THEN
    -- Success: increment succeeded
    v_quota_limit := CASE WHEN v_tier = 'free' THEN 3 ELSE NULL END;
    RETURN QUERY SELECT
      true,                    -- success
      v_new_quota,            -- new_quota
      v_tier,                 -- tier
      v_quota_limit;          -- quota_limit
  ELSE
    -- Failure: user not found or quota exceeded
    -- Return failure with current state for logging
    SELECT COUNT(*), 'free'::text INTO v_rows_affected, v_tier
    FROM public.users WHERE id = p_user_id;

    IF v_rows_affected = 0 THEN
      -- User doesn't exist (should not happen post-auth)
      RETURN QUERY SELECT
        false,        -- success
        0,            -- new_quota
        'free'::text, -- tier
        3;            -- quota_limit
    ELSE
      -- User exists but quota exceeded
      SELECT analyses_used, "tier" INTO v_new_quota, v_tier
      FROM public.users WHERE id = p_user_id;

      v_quota_limit := CASE WHEN v_tier = 'free' THEN 3 ELSE NULL END;
      RETURN QUERY SELECT
        false,           -- success
        v_new_quota,     -- new_quota
        v_tier,          -- tier
        v_quota_limit;   -- quota_limit
    END IF;
  END IF;
END;
$$;

-- Decrement quota on failure (rollback for OpenRouter failures, etc.)
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
  UPDATE public.users
  SET analyses_used = GREATEST(0, analyses_used - p_decrement)
  WHERE id = p_user_id
  RETURNING analyses_used, "tier" INTO v_new_quota, v_tier;

  IF FOUND THEN
    RETURN QUERY SELECT v_new_quota, v_tier;
  ELSE
    RETURN QUERY SELECT 0, 'free'::text;
  END IF;
END;
$$;
