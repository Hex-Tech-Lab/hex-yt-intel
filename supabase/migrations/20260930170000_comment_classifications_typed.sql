-- Comments Dispatch A (2026-09-30): typed Jev classification columns +
-- Cochran-mode plumbing for the async comment sampling pipeline.
--
-- 1. comment_classifications gains nullable typed columns for the Jev
--    classifier output (JevCommentClassifier, PR #376). All nullable: legacy
--    uncapped rows keep only `label` (kept, unused), and a classification
--    row is now upserted idempotently per (comment_sample_run_id,
--    comment_external_id) so a queue retry never duplicates rows.
-- 2. comment_sample_runs gains `mode` ('uncapped' | 'cochran') so the
--    Cochran-sampled system backfill is distinguishable from the
--    user-charged uncapped tier at the storage layer. Default 'uncapped'
--    keeps in-flight/legacy rows valid.
-- 3. Settings Registry: comments.sampling.recencyPoolMaxPages (worker-side
--    recency-ordered pool page cap for mode='cochran'; relevance side reuses
--    the existing comments.sampling.syncPoolMaxPages).
--
-- NOT applied by this agent (CC applies migrations, ADR 018).

-- ============================================================================
-- 1. comment_classifications typed columns + idempotent-retry uniqueness
-- ============================================================================
alter table public.comment_classifications
  add column if not exists sentiment text check (sentiment in ('positive', 'negative', 'neutral', 'mixed')),
  add column if not exists comment_type text check (comment_type in ('question', 'praise', 'criticism', 'suggestion', 'experience', 'spam', 'off_topic')),
  add column if not exists pain_point real check (pain_point >= 0 and pain_point <= 1),
  add column if not exists question_asked real check (question_asked >= 0 and question_asked <= 1),
  add column if not exists intensity real check (intensity >= 0 and intensity <= 2),
  add column if not exists sentiment_confidence real check (sentiment_confidence >= 0 and sentiment_confidence <= 1),
  add column if not exists low_confidence boolean,
  add column if not exists comment_text text,
  add column if not exists like_count integer,
  add column if not exists published_at timestamptz;

-- Cochran rows carry no classification batch (the classifier batches
-- internally); the original NOT NULL constraint from
-- 20260724130000_comments_sampling_engine.sql would reject them.
alter table public.comment_classifications alter column batch_id drop not null;
-- comment_external_id stays NOT NULL (#378 review P2): NULLs never collide
-- in a Postgres unique index, so a nullable key would let retries duplicate
-- ID-less comments. The worker always supplies a key: the YouTube comment id,
-- or a stable sha256 of author|publishedAt|text when YouTube returns none.

-- Idempotent retries: re-persisting the same comment within one sample run
-- must upsert, not duplicate. Existing duplicate groups (if any) would block
-- the unique index; keep exactly one deterministic row per group -- the
-- smallest (created_at, id) -- so equal timestamps cannot leave a tie behind.
delete from public.comment_classifications a
using public.comment_classifications b
where a.comment_sample_run_id = b.comment_sample_run_id
  and a.comment_external_id = b.comment_external_id
  and (b.created_at, b.id) < (a.created_at, a.id);
create unique index if not exists uq_comment_classifications_run_comment
  on public.comment_classifications (comment_sample_run_id, comment_external_id);

-- ============================================================================
-- 2. comment_sample_runs.mode
-- ============================================================================
alter table public.comment_sample_runs
  add column if not exists mode text not null default 'uncapped' check (mode in ('uncapped', 'cochran'));

-- ============================================================================
-- 3. Settings Registry key
-- ============================================================================
insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'comments.sampling.recencyPoolMaxPages',
    'system', 'number', '{"min": 1, "max": 50}'::jsonb, '10'::jsonb,
    'Page cap for the recency (order=time) comment pool fetched by the worker in Cochran mode (mode=cochran). The relevance pool reuses comments.sampling.syncPoolMaxPages. Both pools are de-duplicated before stratified sampling.',
    'admin'
  )
on conflict (key) do nothing;
