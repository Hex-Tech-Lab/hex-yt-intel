-- PERFORMANCE OPTIMIZATION: RLS Policy Wrapping
-- Timestamp: 2026-05-21
-- Purpose: Optimize RLS policies by wrapping auth functions in scalar subqueries
-- Rationale (Supabase Best Practice): Prevents auth.uid() and auth.role() from being evaluated per-row on large table scans.

DO $$ BEGIN
  -- ============================================================================
  -- PUBLIC.ANALYSES TABLE
  -- ============================================================================
  DROP POLICY IF EXISTS "analyses_insert_own" ON public.analyses;
  CREATE POLICY "analyses_insert_own"
    ON public.analyses
    FOR INSERT
    WITH CHECK (
      (select auth.role()) = 'authenticated' AND
      (select auth.uid()) IS NOT NULL AND
      (select auth.uid()) = user_id
    );

  DROP POLICY IF EXISTS "analyses_select_own" ON public.analyses;
  CREATE POLICY "analyses_select_own"
    ON public.analyses
    FOR SELECT
    USING (
      (select auth.role()) = 'authenticated' AND
      (select auth.uid()) = user_id
    );

  DROP POLICY IF EXISTS "analyses_update_own" ON public.analyses;
  CREATE POLICY "analyses_update_own"
    ON public.analyses
    FOR UPDATE
    USING (
      (select auth.role()) = 'authenticated' AND
      (select auth.uid()) = user_id
    )
    WITH CHECK (
      (select auth.role()) = 'authenticated' AND
      (select auth.uid()) = user_id
    );

  DROP POLICY IF EXISTS "analyses_delete_own" ON public.analyses;
  CREATE POLICY "analyses_delete_own"
    ON public.analyses
    FOR DELETE
    USING (
      (select auth.role()) = 'authenticated' AND
      (select auth.uid()) = user_id
    );

  -- ============================================================================
  -- PUBLIC.USERS TABLE
  -- ============================================================================
  DROP POLICY IF EXISTS "users_insert_auth" ON public.users;
  CREATE POLICY "users_insert_auth"
    ON public.users
    FOR INSERT
    WITH CHECK (
      (select auth.role()) = 'authenticated' AND
      (select auth.uid()) = id
    );

  DROP POLICY IF EXISTS "users_select_own" ON public.users;
  CREATE POLICY "users_select_own"
    ON public.users
    FOR SELECT
    USING (
      (select auth.role()) = 'authenticated' AND
      (select auth.uid()) = id
    );

  DROP POLICY IF EXISTS "users_update_own" ON public.users;
  CREATE POLICY "users_update_own"
    ON public.users
    FOR UPDATE
    USING (
      (select auth.role()) = 'authenticated' AND
      (select auth.uid()) = id
    )
    WITH CHECK (
      (select auth.role()) = 'authenticated' AND
      (select auth.uid()) = id
    );

  -- ============================================================================
  -- PUBLIC.USAGE_LOGS TABLE
  -- ============================================================================
  DROP POLICY IF EXISTS "usage_logs_insert_own" ON public.usage_logs;
  CREATE POLICY "usage_logs_insert_own"
    ON public.usage_logs
    FOR INSERT
    WITH CHECK (
      (select auth.role()) = 'authenticated' AND
      (select auth.uid()) = user_id
    );

  DROP POLICY IF EXISTS "usage_logs_select_own" ON public.usage_logs;
  CREATE POLICY "usage_logs_select_own"
    ON public.usage_logs
    FOR SELECT
    USING (
      (select auth.role()) = 'authenticated' AND
      (select auth.uid()) = user_id
    );
END $$;
