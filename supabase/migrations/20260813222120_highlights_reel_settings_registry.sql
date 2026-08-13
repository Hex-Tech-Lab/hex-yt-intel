-- Highlights-reel auto-scrubber tunables. No hardcoded magic numbers --
-- everything retunable from the settings page without a redeploy, per the
-- standing directive. segmentDurationSeconds is a derived estimate (speech
-- rate ~120-150 wpm, spoken thought ~15-40 words), NOT a calibrated figure --
-- see docs/private/2026-08-13_1539_v2_HIGHLIGHTS_REEL_SHARE_WORKFLOW_SPEC.md.
-- Pending ACL 2026 arXiv 2512.11399 read + internal calibration.

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values (
  'highlights.segmentDurationSeconds',
  'system',
  'number',
  '{"min": 3, "max": 30}'::jsonb,
  '10'::jsonb,
  'Auto-scrubber segment length in seconds (derived estimate from speech-rate/spoken-thought-length research, not a calibrated figure -- see docs/private/2026-08-13_1539_v2_HIGHLIGHTS_REEL_SHARE_WORKFLOW_SPEC.md. Pending ACL 2026 arXiv 2512.11399 read + internal calibration before treating as final.)',
  'admin'
),
(
  'highlights.contextLeadSeconds',
  'system',
  'number',
  '{"min": 0, "max": 10}'::jsonb,
  '2.5'::jsonb,
  'Seconds to scrub back before a highlight timestamp when auto-playing a segment, so playback doesnt open mid-sentence. Clamped to the containing chapter/segment start if that is later than timestamp minus this value.',
  'admin'
)
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key in ('highlights.segmentDurationSeconds', 'highlights.contextLeadSeconds')
on conflict (setting_key, scope_type, scope_id) do nothing;
