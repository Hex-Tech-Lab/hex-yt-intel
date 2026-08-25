-- Variable segment-duration clamps for the highlights reel (2026-08-21).
-- highlights.segmentDurationSeconds (the prior fixed 10s value, migration
-- 20260813222120) is now the FALLBACK for old data where end_seconds still
-- has the old "next highlight start" semantics. For new extractions, the LLM
-- returns a content-driven end timestamp (the real end of the topic being
-- discussed), and the playback/visual layers clamp (end - start) to
-- [minSegmentDurationSeconds, maxSegmentDurationSeconds] per highlight.
--
-- Defaults: min 5s (a real spoken point shorter than 5 seconds is usually
-- filler, not a highlight), max 60s (the prior fixed 10s was too short for
-- longer discussions; 60s covers the 95th percentile of spoken points
-- without letting a mis-parsed "next segment start" end value span the
-- entire gap to the next highlight). Both are Settings Registry keys
-- (re-tunable without a redeploy), not hardcoded constants.

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values (
  'highlights.minSegmentDurationSeconds',
  'system',
  'number',
  '{"min": 2, "max": 15}'::jsonb,
  '5'::jsonb,
  'Minimum clamped duration for a highlights-reel segment. The playback/visual layers clamp each highlight''s real (end - start) to [min, max] so old data with the prior "end = next segment start" semantics doesn''t produce 15-minute "segments" while new data with content-driven end timestamps isn''t truncated shorter than this floor. Paired with highlights.maxSegmentDurationSeconds (migration 20260821120000). Replaces no hardcoded constant -- the prior fixed 10s was highlights.segmentDurationSeconds, which remains as the fallback for old rows.',
  'admin'
),
(
  'highlights.maxSegmentDurationSeconds',
  'system',
  'number',
  '{"min": 30, "max": 300}'::jsonb,
  '60'::jsonb,
  'Maximum clamped duration for a highlights-reel segment. Prevents old data with the prior "end = next segment start" semantics from producing a segment that spans the entire gap to the next highlight (the reported "94% of video duration" symptom). New extractions return a content-driven end timestamp; this cap is the defensive ceiling against a mis-parsed end value. Paired with highlights.minSegmentDurationSeconds.',
  'admin'
)
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key in ('highlights.minSegmentDurationSeconds', 'highlights.maxSegmentDurationSeconds')
on conflict (setting_key, scope_type, scope_id) do nothing;
