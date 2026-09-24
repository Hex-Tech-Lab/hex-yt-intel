-- Drop unused pgvector column and semantic-search RPC.
-- Search uses Upstash Vector; analyses.embedding had 1 non-null row of 119 and
-- search_analyses_semantic had zero code callers (verified 2026-09-24).
-- Dropping the column also drops its dependent index idx_analyses_embedding.
-- The vector extension is intentionally left installed (other objects may use it).

DROP FUNCTION IF EXISTS public.search_analyses_semantic(
  vector, double precision, integer, uuid, timestamp with time zone, timestamp with time zone
);

ALTER TABLE public.analyses DROP COLUMN IF EXISTS embedding;
