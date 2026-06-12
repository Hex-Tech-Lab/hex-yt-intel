-- Migration: atomic compare-and-reserve for billing quota
CREATE OR REPLACE FUNCTION public.reserve_analysis_quota(
  p_user_id uuid,
  p_video_id text,
  p_title text,
  p_validation_report jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_analysis_id uuid;
  v_start_of_month timestamptz;
  v_tier text;
  v_limit integer;
BEGIN
  -- Security check
  IF auth.uid() IS NOT NULL AND auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Quota operation not permitted for user %', p_user_id;
  END IF;

  v_start_of_month := date_trunc('month', now());

  -- Get user tier
  SELECT users.tier INTO v_tier
  FROM public.users
  WHERE id = p_user_id;

  v_limit := CASE WHEN v_tier = 'free' THEN 3 ELSE 999999 END;

  -- Count active analyses for this user this month (completed or processing younger than 15m)
  SELECT count(*) INTO v_count
  FROM public.analyses
  WHERE user_id = p_user_id
    AND created_at >= v_start_of_month
    AND (
      billing_status = 'completed'
      OR (billing_status = 'processing' AND created_at >= now() - interval '15 minutes')
    );

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'Monthly quota exhausted';
  END IF;

  -- Rename any existing conflicting row (non-destructive refresh)
  UPDATE public.analyses
  SET video_id = video_id || '_archived_' || extract(epoch from now())::text
  WHERE user_id = p_user_id AND video_id = p_video_id;

  -- Insert the new processing stub
  INSERT INTO public.analyses (
    user_id,
    video_id,
    title,
    analysis_markdown,
    analysis_payload,
    model_used,
    validation_report,
    validation_passed,
    billing_status
  )
  VALUES (
    p_user_id,
    p_video_id,
    p_title,
    '',
    '{}'::jsonb,
    'edge-stream',
    p_validation_report,
    false,
    'processing'
  )
  RETURNING id INTO v_analysis_id;

  RETURN v_analysis_id;
END;
$$;
