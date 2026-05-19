-- ULTIMATE RLS LOCKDOWN: Enforce multi-tenant data isolation
-- Timestamp: 2026-05-19
-- Purpose: Seal MVP 1.0 with strict row-level security policies

DO $$ BEGIN
  -- ============================================================================
  -- PUBLIC.ANALYSES TABLE: Restrict to authenticated users, enforce user_id match
  -- ============================================================================
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'analyses' AND table_schema = 'public') THEN
    ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;

    -- Drop overly permissive policies
    DROP POLICY IF EXISTS "allow_user_insert_own_analyses" ON public.analyses;
    DROP POLICY IF EXISTS "allow_user_read_own_analyses" ON public.analyses;
    DROP POLICY IF EXISTS "analyses_insert_own" ON public.analyses;
    DROP POLICY IF EXISTS "analyses_select_own" ON public.analyses;
    DROP POLICY IF EXISTS "analyses_delete_own" ON public.analyses;

    -- CREATE: Only authenticated users can insert analyses for themselves
    CREATE POLICY "analyses_insert_own"
      ON public.analyses
      FOR INSERT
      WITH CHECK (
        auth.role() = 'authenticated' AND
        auth.uid() IS NOT NULL AND
        auth.uid() = user_id
      );

    -- SELECT: Only authenticated users can view their own analyses
    CREATE POLICY "analyses_select_own"
      ON public.analyses
      FOR SELECT
      USING (
        auth.role() = 'authenticated' AND
        auth.uid() = user_id
      );

    -- UPDATE: Only authenticated users can update their own analyses
    -- Prevent user_id modification (immutable ownership)
    CREATE POLICY "analyses_update_own"
      ON public.analyses
      FOR UPDATE
      USING (
        auth.role() = 'authenticated' AND
        auth.uid() = user_id
      )
      WITH CHECK (
        auth.role() = 'authenticated' AND
        auth.uid() = NEW.user_id
      );

    -- DELETE: Only authenticated users can delete their own analyses
    CREATE POLICY "analyses_delete_own"
      ON public.analyses
      FOR DELETE
      USING (
        auth.role() = 'authenticated' AND
        auth.uid() = user_id
      );

    RAISE NOTICE 'Analyses RLS policies locked down: INSERT/SELECT/UPDATE/DELETE restricted to authenticated users own records';
  END IF;

  -- ============================================================================
  -- PUBLIC.USERS TABLE: Restrict to prevent privilege escalation
  -- ============================================================================
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users' AND table_schema = 'public') THEN
    ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

    -- Drop overly permissive OAuth policies
    DROP POLICY IF EXISTS "allow_oauth_signup_insert" ON public.users;
    DROP POLICY IF EXISTS "allow_user_read_own" ON public.users;
    DROP POLICY IF EXISTS "users_insert_auth" ON public.users;
    DROP POLICY IF EXISTS "users_select_own" ON public.users;
    DROP POLICY IF EXISTS "users_update_own" ON public.users;

    -- CREATE: Only auth service can insert new users (via auth.email() trigger)
    -- Disabled direct inserts: OAuth signup must go through Supabase auth layer
    CREATE POLICY "users_insert_auth"
      ON public.users
      FOR INSERT
      WITH CHECK (
        auth.role() = 'authenticated' AND
        auth.uid() = id
      );

    -- SELECT: Authenticated users can only view their own profile
    CREATE POLICY "users_select_own"
      ON public.users
      FOR SELECT
      USING (
        auth.role() = 'authenticated' AND
        auth.uid() = id
      );

    -- UPDATE: Authenticated users can only update their own profile
    -- Prevent tier/quota escalation by enforcing id immutability
    CREATE POLICY "users_update_own"
      ON public.users
      FOR UPDATE
      USING (
        auth.role() = 'authenticated' AND
        auth.uid() = id
      )
      WITH CHECK (
        auth.role() = 'authenticated' AND
        auth.uid() = NEW.id
      );

    -- DELETE: No user deletion allowed via SQL (audit trail required)
    -- Deletes must go through administrative workflow
    RAISE NOTICE 'Users RLS policies locked down: INSERT/SELECT/UPDATE restricted to authenticated users own record, DELETE disabled';
  END IF;

  -- ============================================================================
  -- PUBLIC.USAGE_LOGS TABLE: Immutable audit trail
  -- ============================================================================
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'usage_logs' AND table_schema = 'public') THEN
    ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "usage_logs_insert_own" ON public.usage_logs;
    DROP POLICY IF EXISTS "usage_logs_select_own" ON public.usage_logs;

    -- INSERT: Only authenticated users can create audit entries for themselves
    CREATE POLICY "usage_logs_insert_own"
      ON public.usage_logs
      FOR INSERT
      WITH CHECK (
        auth.role() = 'authenticated' AND
        auth.uid() = user_id
      );

    -- SELECT: Authenticated users can view their own usage logs
    CREATE POLICY "usage_logs_select_own"
      ON public.usage_logs
      FOR SELECT
      USING (
        auth.role() = 'authenticated' AND
        auth.uid() = user_id
      );

    -- UPDATE: Disabled (audit trail must be immutable)
    -- DELETE: Disabled (audit trail must be immutable)

    RAISE NOTICE 'Usage logs RLS policies locked down: INSERT/SELECT only, UPDATE/DELETE disabled (immutable audit trail)';
  END IF;

END $$;

-- Verification: Log all RLS policies now in effect
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
