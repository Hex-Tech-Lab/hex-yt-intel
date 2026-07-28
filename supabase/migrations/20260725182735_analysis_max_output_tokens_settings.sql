-- worker/src/services/LLMCascade.ts's max_tokens per model was hardcoded
-- (isHaiku45 ? 62000 : 16000) -- the 62000 value was a "for testing" bump
-- (commit e18b82f, 2026-06-13) never reverted, and broke every production
-- analysis today (2026-07-25) once account credits tightened: 5 parallel
-- streams x 62000 requested tokens each trips OpenRouter's per-request
-- affordability check. Reverted to 8192 in code; moved into the registry per
-- the standing no-hardcoded-tunables directive so it's retunable without a
-- worker redeploy going forward.

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'analysis.maxOutputTokens.haiku',
    'system',
    'number',
    '{"min": 1024, "max": 16384}'::jsonb,
    '8192'::jsonb,
    'max_tokens sent to OpenRouter for Claude Haiku 4.5 cascade tiers in worker/src/services/LLMCascade.ts. Was hardcoded to 62000 (a forgotten testing value) until the 2026-07-25 production outage.',
    'admin'
  ),
  (
    'analysis.maxOutputTokens.default',
    'system',
    'number',
    '{"min": 1024, "max": 32000}'::jsonb,
    '16000'::jsonb,
    'max_tokens sent to OpenRouter for non-Haiku cascade tiers (e.g. Sonnet) in worker/src/services/LLMCascade.ts.',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key in ('analysis.maxOutputTokens.haiku', 'analysis.maxOutputTokens.default')
on conflict (setting_key, scope_type, scope_id) do nothing;
