-- ADR 020 Phase 3 review fix: PersistService (worker) retries the whole
-- persist HTTP call up to 2x if the response is lost after a successful DB
-- write, which could log a second 'analysis_completed' usage_logs row for
-- the same analysisId -- harmless before this feature (a pure count-only
-- usage-log dup), but now double-counts real dollar cost. One event per
-- analysis, enforced at the DB level rather than trusted to caller logic.
create unique index if not exists idx_usage_logs_analysis_completed_dedup
  on public.usage_logs (((metadata->>'analysisId')))
  where action = 'analysis_completed';
