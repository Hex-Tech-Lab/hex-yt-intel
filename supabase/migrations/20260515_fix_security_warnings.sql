-- Fix security warnings from Supabase database linter (2026-05-15)

-- Fix 1: Function search_path - Set immutable search_path for delete_old_free_analyses
CREATE OR REPLACE FUNCTION public.delete_old_free_analyses()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.analyses
  WHERE user_id IN (
    SELECT id FROM public.users WHERE tier = 'free'
  )
  AND created_at < NOW() - INTERVAL '30 days';
END;
$$;

-- Fix 2: Function search_path - Set immutable search_path for update_updated_at_column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Fix 3: Replace overly permissive RLS policy on stripe_events
-- Remove the policy that allows unrestricted access via auth.role() = '-'
DROP POLICY IF EXISTS "Service role can manage stripe events" ON public.stripe_events;

-- Replace with a proper policy that explicitly checks for service_role
CREATE POLICY "Service role can manage stripe events"
  ON public.stripe_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Ensure RLS is enabled on stripe_events table
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;

-- Note: Vector extension in public schema is acceptable for now
-- Moving it requires recreating pgvector columns in all tables that use it
-- Can be addressed in a future migration with more careful planning
