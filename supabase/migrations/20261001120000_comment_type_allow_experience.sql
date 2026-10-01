-- Allow comment_type = 'experience' (Jev classifier category, added 2026-09-30).
--
-- 20260930170000_comment_classifications_typed.sql declared the column with
-- 'experience' in its CHECK, but via `add column if not exists`: the column
-- already existed (20260725120000), so Postgres skipped the whole definition
-- and kept the July constraint. Every cochran persist containing an
-- 'experience' comment failed with 23514 (Sentry HEX-YT-INTEL-5Y, 2026-10-01).
-- Widening only: every existing row still satisfies the new constraint.
alter table public.comment_classifications
  drop constraint if exists comment_classifications_comment_type_check;
alter table public.comment_classifications
  add constraint comment_classifications_comment_type_check
  check (comment_type in ('question', 'praise', 'criticism', 'suggestion', 'experience', 'spam', 'off_topic'));
