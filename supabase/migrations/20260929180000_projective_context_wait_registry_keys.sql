-- R2b (2026-09-29): the projective bundle's grounded context is now loaded
-- server-side from PERSISTED grounded chunks
-- (POST /api/analyses/[id]/projective-context). Until every grounded chunk is
-- persisted the route answers 409 and the client polls:
--   analysis.layer2.projectiveContextRetryAfterMs  poll interval
--   analysis.layer2.projectiveContextMaxWaitMs     total wait before the
--     projective bundle is dispatched WITHOUT grounded context (degrades,
--     never hangs)
-- Defaults are starting points, not measured values: tune from real
-- grounded-persist latency (worker persist is fire-and-forget S2S).
insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'analysis.layer2.projectiveContextRetryAfterMs',
    'system',
    'number',
    '{"min": 250, "max": 10000}'::jsonb,
    '1500'::jsonb,
    'Poll interval (ms) the client waits between projective-context requests while grounded chunks are not yet persisted (R2b).',
    'admin'
  ),
  (
    'analysis.layer2.projectiveContextMaxWaitMs',
    'system',
    'number',
    '{"min": 1000, "max": 120000}'::jsonb,
    '20000'::jsonb,
    'Maximum total wait (ms) for persisted grounded chunks before the projective bundle is dispatched without grounded context (R2b). Degrades instead of hanging.',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key in ('analysis.layer2.projectiveContextRetryAfterMs', 'analysis.layer2.projectiveContextMaxWaitMs')
on conflict (setting_key, scope_type, scope_id) do nothing;
