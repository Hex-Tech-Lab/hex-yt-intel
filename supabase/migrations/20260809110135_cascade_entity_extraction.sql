-- ADR 026 Phase 1: dedicated model cascade for chunk-scoped grounded entity
-- extraction, separately named/logged from cascade.analysis so OpenRouter's
-- app-source logs attribute entity-extraction cost independently from
-- dimension-synthesis cost (docs/private/ADR_026_GROUNDED_ENTITY_EXTRACTION_2026-08-09.md
-- §4.5). Cerebras primary / Groq fallback, both openai/gpt-oss-120b -- same
-- model/provider pairing already verified live in cascade.chat's migration
-- 20260725171735_cascade_registry.sql, reused here rather than re-verified.

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'cascade.entityExtraction',
    'system',
    'json',
    '{}'::jsonb,
    '[
      {"model": "openai/gpt-oss-120b", "name": "gpt-oss-120b (Cerebras)", "cost": 0.00035, "providerOrder": ["cerebras"]},
      {"model": "openai/gpt-oss-120b", "name": "gpt-oss-120b (Groq)", "cost": 0.00015, "providerOrder": ["groq"]}
    ]'::jsonb,
    'Chunk-scoped grounded entity extraction LLM fallback cascade (ADR 026 §4.5): array of {model, name, cost?, providerOrder?} tiers tried in order, primary first. Cerebras primary, Groq fallback -- dedicated from cascade.analysis so OpenRouter cost logs separate extraction spend from dimension-synthesis spend.',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key = 'cascade.entityExtraction'
on conflict (setting_key, scope_type, scope_id) do nothing;
