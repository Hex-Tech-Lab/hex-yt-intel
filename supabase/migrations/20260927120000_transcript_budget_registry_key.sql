-- Transcript prompt budget (2026-09-27): replaces the hardcoded 48000-char
-- slice in web/lib/prompts/factory.ts getUCISPrompt (standing
-- no-hardcoded-tunables directive). Registry-resolved by CreateAnalysisUseCase
-- and forwarded per-request to the worker (no DB access there, ADR 005).
-- Default preserved from the legacy hardcoded value so behavior is unchanged
-- until explicitly tuned; the value's real derivation (coverage vs quality vs
-- cost) is a Phase B / bake-off decision, NOT a padded guess.
insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'analysis.transcriptBudgetChars',
    'system',
    'number',
    '{"min": 1000, "max": 200000}'::jsonb,
    '48000'::jsonb,
    'Maximum transcript characters embedded in the analysis prompt. Legacy default 48000 was hardcoded in getUCISPrompt and silently truncated long-form videos (3h videos sent ~27% of their transcript while the log read "completed successfully"). The truncation is now surfaced in-band in the prompt AND as a client-side status event. Tuning this tradeoff (coverage vs cost vs quality) is a bake-off/Phase-B decision -- do not bump without empirical backing.',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key = 'analysis.transcriptBudgetChars'
on conflict (setting_key, scope_type, scope_id) do nothing;
