-- ADVANCED HARDENING: Performance, Security, and Integrity (Supabase Best Practices)
-- Timestamp: 2026-06-01
-- Target: v1.1.0 Infrastructure Upgrade

DO $$ BEGIN
  -- ============================================================================
  -- 1. SECURITY: Enforce RLS on stripe_events (security-rls-basics.md)
  -- ============================================================================
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stripe_events' AND table_schema = 'public') THEN
    ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "stripe_events_select_own" ON public.stripe_events;
    CREATE POLICY "stripe_events_select_own"
      ON public.stripe_events
      FOR SELECT
      USING ((select auth.uid()) = user_id); -- scalar subquery optimized
      
    RAISE NOTICE 'RLS enabled and policy created for stripe_events';
  END IF;

  -- ============================================================================
  -- 2. INTEGRITY: Expand usage_logs action constraint
  -- ============================================================================
  -- Drop existing inline or named constraint and replace with expanded telemetry set
  DECLARE
    v_constraint_name text;
  BEGIN
    SELECT conname INTO v_constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'usage_logs'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%action%';

    IF v_constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.usage_logs DROP CONSTRAINT %I', v_constraint_name);
    END IF;
  END;

  ALTER TABLE public.usage_logs 
  ADD CONSTRAINT usage_logs_action_check 
  CHECK (action = ANY (ARRAY[
    'analysis', 
    'search', 
    'export', 
    'api_call', 
    'embedding_generation', 
    'checkout_initiated', 
    'invoice_paid',
    'subscription_created',
    'subscription_deleted'
  ]));

  -- ============================================================================
  -- 3. PERFORMANCE: JSONB GIN Indexing (advanced-jsonb-indexing.md)
  -- ============================================================================
  CREATE INDEX IF NOT EXISTS idx_usage_logs_metadata_gin 
  ON public.usage_logs USING gin (metadata);

  -- ============================================================================
  -- 4. PERFORMANCE: Optimized Covering Index for Cache (query-covering-indexes.md)
  -- ============================================================================
  -- Drop existing index and replace with a covering version to allow index-only scans
  DROP INDEX IF EXISTS idx_analyses_cache_lookup;
  CREATE INDEX idx_analyses_cache_lookup
  ON public.analyses(user_id, video_id, created_at DESC)
  INCLUDE (id, title);

  -- ============================================================================
  -- 5. SCHEMA: Text over Varchar for LLM columns (schema-data-types.md)
  -- ============================================================================
  ALTER TABLE public.analyses 
    ALTER COLUMN model_used TYPE text,
    ALTER COLUMN model_attempted TYPE text;

  RAISE NOTICE 'v1.1.0 Database Optimizations Applied Successfully';

END $$;
