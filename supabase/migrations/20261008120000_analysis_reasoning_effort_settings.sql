-- Per-stream reasoning effort for analysis cascade calls (2026-10-08).
-- Registry-driven per the standing no-hardcoded-tunables directive. NOT applied
-- by the implementing agent (ADR 018: CC applies migrations).
--
-- Previously worker/src/services/LLMCascade.ts hardcoded reasoning effort
-- 'low' on every call. Grounded/deterministic bundles (dimensions 1-4 style
-- extraction) gain nothing from reasoning tokens; projective/combiner bundles
-- get lightweight reasoning.
--
-- Allowed values: 'none' | 'minimal' | 'low' -- enforced at admin SAVE time by
-- data_type 'enum' + enumValues (validateAgainstContract), and again at resolve
-- time (web/lib/config/cascade.ts) and dispatch time (worker clamp). Higher efforts are
-- deliberately not accepted -- the cascade (and these stamped values) reach
-- the worker through the browser-relayed request body, which is not yet
-- signed, so the worker never trusts anything above 'low'.
-- 'none' becomes `reasoning: { enabled: false }`; models whose OpenRouter
-- metadata marks reasoning as mandatory (e.g. z-ai/glm-5.3-flash) are bumped
-- to 'low' at resolve time instead, since a concrete slug returns 400 for
-- disabled reasoning on such models.

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'analysis.reasoning.grounded',
    'system',
    'enum',
    '{"enumValues": ["none", "minimal", "low"]}'::jsonb,
    '"none"'::jsonb,
    'Reasoning effort for grounded/deterministic analysis bundles: none | minimal | low. Defaults to none (reasoning disabled).',
    'admin'
  ),
  (
    'analysis.reasoning.projective',
    'system',
    'enum',
    '{"enumValues": ["none", "minimal", "low"]}'::jsonb,
    '"low"'::jsonb,
    'Reasoning effort for projective/combiner analysis bundles: none | minimal | low. Defaults to low.',
    'admin'
  )
on conflict (key) do nothing;
