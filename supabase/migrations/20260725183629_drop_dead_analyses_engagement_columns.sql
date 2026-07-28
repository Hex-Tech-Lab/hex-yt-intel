-- analyses.comment_count/view_count/like_count: confirmed dead (2026-07-25
-- audit). No adapter ever writes them (grep across web/lib/adapters found
-- zero writes), no adapter ever selects them, and no DB function/RPC
-- references them (information_schema.routines search came back empty).
-- The real engagement numbers live in validation_report.metadata (jsonb,
-- populated by AnalysisJobMetadata) and are read from there everywhere they
-- matter (chat grounding, history overview). These three columns were
-- flagged as a pre-existing gap during the 2026-07-25 comments-cascade
-- session and confirmed unused rather than wired up, since adding write
-- plumbing for data nobody reads would just be more dead code.

alter table public.analyses
  drop column if exists comment_count,
  drop column if exists view_count,
  drop column if exists like_count;
