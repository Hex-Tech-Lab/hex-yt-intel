-- T12c (2026-10-13): global sweep for stuck comment_sample_runs + per-delivery claim token.
-- Additive: nullable columns plus two seeded Settings Registry rows. NOT applied by the implementing agent (ADR 018/013: CI applies on merge).
--
-- claimed_by:     queue delivery token that won the pending -> sampling claim. A redelivered
--                 message carrying the same token may proceed (idempotent claim); any other
--                 token gets claimed:false.
-- claimed_at:     when the pending -> sampling claim landed. The sweep measures 'sampling'
--                 staleness from here (not created_at), so a run that waited in pending and
--                 was only just claimed by a live consumer is never failed under it. Null
--                 (pre-migration rows) falls back to reenqueued_at, then created_at.
-- reenqueued_at:  set once the global sweep has re-enqueued a stale 'pending' run. A run that is
--                 still 'pending' pendingStaleMinutes after this timestamp is marked failed.

alter table public.comment_sample_runs
  add column if not exists claimed_by text null,
  add column if not exists claimed_at timestamptz null,
  add column if not exists reenqueued_at timestamptz null;

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'comments.sweep.pendingStaleMinutes',
    'system',
    'number',
    '{"min": 1, "max": 1440}'::jsonb,
    '30'::jsonb,
    'Minutes a comment_sample_runs row may sit in pending before the global sweep re-enqueues it once (then fails it if still pending). Defaults to 30.',
    'admin'
  ),
  (
    'comments.sweep.samplingStaleMinutes',
    'system',
    'number',
    '{"min": 1, "max": 1440}'::jsonb,
    '30'::jsonb,
    'Minutes a comment_sample_runs row may sit in sampling before the global sweep marks it failed. Defaults to 30.',
    'admin'
  )
on conflict (key) do nothing;
