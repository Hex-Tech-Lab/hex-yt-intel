-- ULTIMATE RLS LOCKDOWN: Enforce multi-tenant data isolation
-- Timestamp: 2026-05-19
-- Purpose: Seal MVP 1.0 with strict row-level security policies

-- ============================================================================
-- SETUP: Enable RLS and drop old policies
-- ============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'analyses' AND table_schema = 'public') THEN
    ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "allow_user_insert_own_analyses" ON public.analyses;
    DROP POLICY IF EXISTS "allow_user_read_own_analyses" ON public.analyses;
    DROP POLICY IF EXISTS "analyses_insert_own" ON public.analyses;
    DROP POLICY IF EXISTS "analyses_select_own" ON public.analyses;
    DROP POLICY IF EXISTS "analyses_delete_own" ON public.analyses;
    DROP POLICY IF EXISTS "analyses_update_own" ON public.analyses;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users' AND table_schema = 'public') THEN
    ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "allow_oauth_signup_insert" ON public.users;
    DROP POLICY IF EXISTS "allow_user_read_own" ON public.users;
    DROP POLICY IF EXISTS "users_insert_auth" ON public.users;
    DROP POLICY IF EXISTS "users_select_own" ON public.users;
    DROP POLICY IF EXISTS "users_update_own" ON public.users;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'usage_logs' AND table_schema = 'public') THEN
    ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "usage_logs_insert_own" ON public.usage_logs;
    DROP POLICY IF EXISTS "usage_logs_select_own" ON public.usage_logs;
  END IF;
END $$;

-- ============================================================================
-- PUBLIC.ANALYSES TABLE: Restrict to authenticated users, enforce user_id match
-- ============================================================================
CREATE POLICY "analyses_insert_own"
  ON public.analyses
  FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated' AND
    auth.uid() IS NOT NULL AND
    auth.uid() = user_id
  );

CREATE POLICY "analyses_select_own"
  ON public.analyses
  FOR SELECT
  USING (
    auth.role() = 'authenticated' AND
    auth.uid() = user_id
  );

CREATE POLICY "analyses_update_own"
  ON public.analyses
  FOR UPDATE
  USING (
    auth.role() = 'authenticated' AND
    auth.uid() = user_id
  )
  WITH CHECK (
    auth.role() = 'authenticated' AND
    auth.uid() = user_id
  );

CREATE POLICY "analyses_delete_own"
  ON public.analyses
  FOR DELETE
  USING (
    auth.role() = 'authenticated' AND
    auth.uid() = user_id
  );

-- ============================================================================
-- PUBLIC.USERS TABLE: Restrict to prevent privilege escalation
-- ============================================================================
CREATE POLICY "users_insert_auth"
  ON public.users
  FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated' AND
    auth.uid() = id
  );

CREATE POLICY "users_select_own"
  ON public.users
  FOR SELECT
  USING (
    auth.role() = 'authenticated' AND
    auth.uid() = id
  );

CREATE POLICY "users_update_own"
  ON public.users
  FOR UPDATE
  USING (
    auth.role() = 'authenticated' AND
    auth.uid() = id
  )
  WITH CHECK (
    auth.role() = 'authenticated' AND
    auth.uid() = id
  );

-- ============================================================================
-- PUBLIC.USAGE_LOGS TABLE: Immutable audit trail
-- ============================================================================
CREATE POLICY "usage_logs_insert_own"
  ON public.usage_logs
  FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated' AND
    auth.uid() = user_id
  );

CREATE POLICY "usage_logs_select_own"
  ON public.usage_logs
  FOR SELECT
  USING (
    auth.role() = 'authenticated' AND
    auth.uid() = user_id
  );

-- ============================================================================
-- Verification: Log all RLS policies now in effect
-- ============================================================================
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
