-- PERFORMANCE OPTIMIZATION: Semantic Search RPC
-- Timestamp: 2026-05-21
-- Purpose: Push vector cosine similarity calculations to the database layer
-- Rationale (Supabase Best Practice): Prevents downloading all user vectors into Node.js memory.

CREATE OR REPLACE FUNCTION public.search_analyses_semantic(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  p_user_id uuid,
  p_date_from timestamp with time zone DEFAULT NULL,
  p_date_to timestamp with time zone DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  title text,
  analysis_markdown text,
  created_at timestamp with time zone,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.title,
    a.analysis_markdown,
    a.created_at,
    1 - (a.embedding <=> query_embedding) AS similarity
  FROM public.analyses a
  WHERE a.user_id = p_user_id
    AND a.embedding IS NOT NULL
    AND 1 - (a.embedding <=> query_embedding) > match_threshold
    AND (p_date_from IS NULL OR a.created_at >= p_date_from)
    AND (p_date_to IS NULL OR a.created_at <= p_date_to)
  ORDER BY a.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
