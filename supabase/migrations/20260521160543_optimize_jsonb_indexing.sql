-- PERFORMANCE OPTIMIZATION: JSONB Expression Indexing
-- Timestamp: 2026-05-21
-- Purpose: Optimize admin latency queries by indexing specific JSONB keys
-- Rationale (Supabase Best Practice): Prevents full table scans when querying usage_logs by latency_ms within the metadata JSONB column.

DO $$ BEGIN
  -- ============================================================================
  -- PUBLIC.USAGE_LOGS TABLE
  -- ============================================================================
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'usage_logs' AND table_schema = 'public') THEN
    
    -- Create expression index for latency_ms extraction
    -- This optimizes queries like: .filter('metadata->>latency_ms', 'neq', 'null')
    CREATE INDEX IF NOT EXISTS idx_usage_logs_metadata_latency 
    ON public.usage_logs ((metadata->>'latency_ms'));

    RAISE NOTICE 'Created JSONB expression index for usage_logs latency_ms';
  END IF;
END $$;
