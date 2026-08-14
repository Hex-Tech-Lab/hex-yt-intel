-- Caught by /pr-review-workflow's supabase-postgres-best-practices pass on
-- PR #233: the unique(analysis_id, idx) constraint already creates a
-- composite index with analysis_id as the leftmost column, which serves
-- analysis_id-only lookups via the leftmost-column rule -- the separate
-- single-column index was pure redundant weight. Same exact class of finding
-- already fixed once this session on kg_entity_mentions (migration
-- 20260812234150) -- repeated the mistake in this PR's own initial migration.
drop index if exists public.idx_analysis_highlights_analysis_id;
