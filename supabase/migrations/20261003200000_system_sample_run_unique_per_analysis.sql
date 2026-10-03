-- PR #416 follow-up (external review P1): idempotent system-funded comment
-- sample runs. enqueueSystemCommentSampleRun (web/lib/services/
-- aux-remediation.ts) is called at EVERY analysis finalize (persist route
-- chunked + non-chunked paths) and from the aux-remediation harness, but
-- nothing prevented two rows for the same analysis: a repeated/concurrent
-- finalize would create duplicate system-paid Cochran runs (~$0.003 each)
-- and double-enqueue the worker fetch.
--
-- Partial unique index: at most one system-funded (mode='cochran') run per
-- analysis_id. User-charged uncapped runs (tier3/start route,
-- mode='uncapped') are deliberately NOT constrained — a user may pay to
-- re-sample the same video. Existing duplicates (if any) would block the
-- index; none are expected since the system path was added in #416, but the
-- index is still created best-effort-safe: if dup groups exist, dedupe
-- deterministically first, keeping the oldest run per analysis.
--
-- NOT applied by this agent (CC applies migrations, ADR 018; CI applies on
-- merge to main).

-- Deterministic dedupe so the index creation cannot fail on existing data:
-- keep the earliest row per (analysis_id, mode='cochran'), delete the rest.
delete from public.comment_sample_runs a
using public.comment_sample_runs b
where a.mode = 'cochran'
  and b.mode = 'cochran'
  and a.analysis_id = b.analysis_id
  and a.created_at > b.created_at
  or (a.mode = 'cochran'
      and b.mode = 'cochran'
      and a.analysis_id = b.analysis_id
      and a.created_at = b.created_at
      and a.id > b.id);

create unique index if not exists uq_comment_sample_runs_system_per_analysis
  on public.comment_sample_runs (analysis_id)
  where mode = 'cochran';
