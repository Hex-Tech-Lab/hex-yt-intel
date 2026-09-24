-- Drop unused pgvector column and semantic-search RPC.
-- Search uses Upstash Vector; analyses.embedding had 1 non-null row of 119 and
-- search_analyses_semantic had zero code callers (verified 2026-09-24).
-- The vector extension is intentionally left installed (other objects may use it).

DROP FUNCTION IF EXISTS public.search_analyses_semantic(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  p_user_id uuid,
  p_date_from timestamp with time zone DEFAULT NULL,
  p_date_to timestamp with time zone DEFAULT NULL
);

ALTER TABLE public.analyses DROP COLUMN IF EXISTS embedding;
