-- R3b Phase 2.6 time-sync: interval (seconds) between the real [HH:MM:SS]
-- markers inserted into the prompt transcript (web/lib/jev/transcript-time-markers.ts).
-- Registry-driven per the no-hardcoded-tunables directive. 30 s: fine enough
-- that the nearest marker at or before a claim is within half a minute,
-- coarse enough to cost ~3% extra prompt characters (~11 chars per ~400).
insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'analysis.jev.timeMarkerIntervalSeconds',
    'system',
    'number',
    '{"min": 5, "max": 300}'::jsonb,
    '30'::jsonb,
    'Seconds between real [HH:MM:SS] time markers inserted into the prompt transcript so the model cites true video times (R3b Phase 2.6). Defaults to 30.',
    'admin'
  )
on conflict (key) do nothing;
