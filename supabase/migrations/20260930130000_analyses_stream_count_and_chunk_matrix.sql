-- ADR 037 Addendum A (2026-09-30): Option A (map-reduce) topology contract.
-- A2: analyses.stream_count = expected analysis_chunks rows = K x G + P
--     (K Jev chunks, G grounded bundles, P projective bundles). Default 5 is
--     exactly today's TOTAL_STREAMS (K = 1, G = 4, P = 1), so every existing
--     row is correct without a backfill.
-- A4: analysis_chunks gains jev_chunk_index (0-based); chunk_index keeps its
--     meaning (1-based bundle index). Legacy rows are the jev_chunk_index = 0
--     slice. The unique key becomes (analysis_id, jev_chunk_index, chunk_index).
-- NOT APPLIED YET: CC applies via apply_migration and renames this file to the
-- recorded version (ADR 018).

alter table public.analyses
  add column if not exists stream_count integer not null default 5;

alter table public.analyses
  drop constraint if exists analyses_stream_count_range;
alter table public.analyses
  add constraint analyses_stream_count_range check (stream_count between 1 and 1000);

alter table public.analysis_chunks
  add column if not exists jev_chunk_index integer not null default 0;

alter table public.analysis_chunks
  drop constraint if exists analysis_chunks_jev_chunk_index_nonneg;
alter table public.analysis_chunks
  add constraint analysis_chunks_jev_chunk_index_nonneg check (jev_chunk_index >= 0);

-- Add the 2-D unique key ALONGSIDE the old one. The old key
-- unique_analysis_chunk (analysis_id, chunk_index) is NOT dropped here:
-- SupabasePersistenceAdapter upserts with onConflict 'analysis_id,chunk_index'
-- (3 call sites), and Postgres rejects ON CONFLICT without a matching unique
-- constraint, so dropping it now would break every persist in production.
-- Step 2 switches those upserts to 'analysis_id,jev_chunk_index,chunk_index'
-- and a later migration drops the old key once that code is live. Every
-- existing row already satisfies the new key (the old one is strictly stronger).
alter table public.analysis_chunks
  drop constraint if exists unique_analysis_chunk_cell;
alter table public.analysis_chunks
  add constraint unique_analysis_chunk_cell unique (analysis_id, jev_chunk_index, chunk_index);
