-- Phase 5 (batched cheap-tier classification): the user's classification
-- scheme (2026-07-25) needs THREE axes per comment, not one flat label --
-- sentiment (fixed enum, filters noise so off-topic/spam doesn't skew
-- sentiment direction), type (fixed enum, actionable feedback categories),
-- and topic (free-form, per-video clustering -- deliberately unconstrained,
-- explicitly banked as a possible future input to entity/vector mapping,
-- not built now: that's a separate feature touching the KG/embedding
-- pipeline, out of this phase's scope).
--
-- comment_classifications.label (single text column, 20260724130000) never
-- shipped with real writers -- Phase 5 is the first consumer -- so this is
-- a column split, not a data migration.

alter table public.comment_classifications
  drop column if exists label,
  add column if not exists sentiment text check (sentiment in ('positive', 'negative', 'neutral', 'mixed')),
  add column if not exists comment_type text check (comment_type in ('question', 'praise', 'criticism', 'suggestion', 'spam', 'off_topic')),
  add column if not exists topic text;

comment on column public.comment_classifications.sentiment is
  'Fixed 4-way sentiment. Comments where comment_type is spam/off_topic should be excluded from sentiment aggregation at query time -- they are classified but not representative of audience reaction to the video.';
comment on column public.comment_classifications.topic is
  'Free-form, model-chosen per-video topic cluster label -- deliberately unconstrained (no fixed enum) so clustering can reflect what a video''s comments are actually about, not a predefined taxonomy.';
