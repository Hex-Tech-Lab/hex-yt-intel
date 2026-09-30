-- Highlights reel fixes (2026-09-30): the two tunables introduced by
-- fix(highlights) 273ef9b7 were read from the Settings Registry but never
-- seeded, so production silently used the code fallbacks. Seeded here with
-- the same values and the same clamp bounds the highlights API route applies.

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'highlights.seekSettlementTimeoutMs',
    'system',
    'number',
    '{"min": 500, "max": 10000}'::jsonb,
    '2000'::jsonb,
    'Highlights reel: how long (ms) a seek may wait to land near its target before playback continues from the player''s actual time. Stops a manual jump from freezing when YouTube snaps the seek to a keyframe outside the tolerance window.',
    'admin'
  ),
  (
    'highlights.tickerWordsPerSecond',
    'system',
    'number',
    '{"min": 0.5, "max": 10}'::jsonb,
    '2.5'::jsonb,
    'Highlights reel: maximum caption reveal speed in words per second. The caption follows playback time and never scrolls faster than this; text longer than the segment allows is left unfinished rather than rushed.',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key in ('highlights.seekSettlementTimeoutMs', 'highlights.tickerWordsPerSecond')
on conflict (setting_key, scope_type, scope_id) do nothing;
