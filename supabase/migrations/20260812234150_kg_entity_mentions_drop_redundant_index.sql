-- CodeRabbit review on PR #230: idx_kg_entity_mentions_entity_id (single-column,
-- from 20260809165422) is redundant. kg_entity_mentions_entity_chunk_unique
-- (from 20260809173831) is a unique B-tree on (entity_id, chunk_id) -- Postgres
-- can serve entity_id-only lookups from its leftmost column, so the standalone
-- index only adds write overhead and storage with zero query benefit. Verified
-- against real, applied schema before dropping (not assumed from the report).

drop index if exists public.idx_kg_entity_mentions_entity_id;
