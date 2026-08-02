-- Exact traceability directive (2026-08-02): each chunk is one independent
-- OpenRouter call with its own real generation id (OpenRouter's own record
-- of that exact request/response, returned as `id` on every response). One
-- analysis has 5 chunks = 5 distinct generation ids, which is why this lives
-- on analysis_chunks (per-chunk) and not usage_logs (per-analysis aggregate,
-- where a single id field wouldn't correctly represent 5 separate calls).
-- Lets a future cost/billing question be resolved against OpenRouter's own
-- record instead of a timestamp-based guess.
alter table public.analysis_chunks
  add column if not exists openrouter_generation_id text;
