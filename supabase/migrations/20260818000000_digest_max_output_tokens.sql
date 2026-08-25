-- Executive digest (Dimension 0) max_tokens is a Settings Registry key now,
-- not the hardcoded DEFAULT_MAX_TOKENS = 2000 in OpenRouterCompletionAdapter.ts.
-- RCA (2026-08-18 fresh-baseline fidelity test,
-- docs/research/2026-08-18-digest-fresh-haiku-baseline-fidelity-test.md):
-- GPT-OSS-120B (a reasoning model -- spends output tokens on internal
-- reasoning before the visible answer) hit finish_reason=length on 5/14 real
-- rows at the 2000-token cap; Haiku 4.5 never truncated on the same rows.
-- The digest's real expected output is 4 short-to-medium sections (snapshot/
-- overview/takeaways/highlights-adjacent copy) -- comfortably under 4000-6000
-- tokens even generously, per this project's no-hardcoded-magic-numbers rule
-- (check -> count -> estimate, not a blind bump). Setting default to 6000 to
-- give a reasoning model real headroom without being unbounded.

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values (
  'digest.maxOutputTokens',
  'system',
  'number',
  '{"min": 1000, "max": 12000}'::jsonb,
  '6000'::jsonb,
  'max_tokens for the Dimension-0 executive digest completion (OpenRouterCompletionAdapter.complete, digest.maxOutputTokens). Raised from the prior hardcoded 2000 after real GPT-OSS-120B finish_reason=length truncation (5/14 rows) in the 2026-08-18 fresh-baseline fidelity test -- GPT-OSS is a reasoning model and spends output budget on internal reasoning before the visible answer, unlike Haiku 4.5 which never truncated at the same cap on the same rows.',
  'admin'
)
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key = 'digest.maxOutputTokens'
on conflict (setting_key, scope_type, scope_id) do nothing;
