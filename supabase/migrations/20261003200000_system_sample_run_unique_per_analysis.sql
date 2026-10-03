-- PR #416 follow-up (external review P1): idempotent system-funded comment
-- sample runs. enqueueSystemCommentSampleRun (web/lib/services/
-- aux-remediation.ts) is called at EVERY analysis finalize (persist route
-- chunked + non-chunked paths) and from the aux-remediation harness, but
-- nothing prevented two rows for the same analysis: a repeated/concurrent
-- finalize would create duplicate system-paid Cochran runs (~$0.003 each)
-- and double-enqueue the worker fetch.
--
-- Partial unique index: at most one non-failed system-funded (mode='cochran')
-- run per analysis_id. Failed runs are excluded from the index on purpose:
-- a failed run must not block a future system retry (real production data
-- 2026-10-03 shows analyses whose cochran runs all failed and would
-- otherwise be permanently locked out). User-charged uncapped runs
-- (tier3/start route, mode='uncapped') are deliberately NOT constrained —
-- a user may pay to re-sample the same video.
--
-- NO dedupe/delete runs here. Live data verified 2026-10-03: 41 analyses
-- have cochran runs and at most one non-failed cochran run per analysis
-- (the one analysis with 6 runs has 5 failed + 1 completed), so the index
-- builds cleanly. Do NOT keep-old-row dedupe: that would delete a newer
-- completed run while older failed runs survive, and comment_classifications
-- + estimate_reconciliation_log cascade on comment_sample_runs deletion —
-- real classifications would be destroyed.
--
-- Matches SupabaseAuxRemediationAdapter.hasSystemSampleRun
-- (web/lib/adapters/SupabaseAuxRemediationAdapter.ts), which probes
-- analysis_id + mode='cochran' + status <> 'failed'; status values come from
-- the table's check constraint ('pending','sampling','completed','failed',
-- supabase/migrations/20260724130000_comments_sampling_engine.sql:104), so
-- pending/sampling/completed block and failed does not.
--
-- NOT applied by this agent (CC applies migrations, ADR 018; CI applies on
-- merge to main).

create unique index if not exists uq_comment_sample_runs_system_per_analysis
  on public.comment_sample_runs (analysis_id)
  where mode = 'cochran' and status <> 'failed';
