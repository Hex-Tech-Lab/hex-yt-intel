-- ADR 020 Phase 3: cost ledger. Each chunk is an independent OpenRouter call
-- (one dimension-bundle) with its own real usage/cost; stored per-chunk so
-- the finalize path can SUM across all chunks for one analysis's true total
-- cost, rather than only capturing the last chunk to persist.
alter table public.analysis_chunks
  add column if not exists tokens_used integer default 0,
  add column if not exists cost_usd numeric default 0;
