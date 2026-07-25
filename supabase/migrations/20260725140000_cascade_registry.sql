-- Move all LLM fallback cascades (chat/analysis/stance/reasoning) into the
-- settings registry (setting_definitions/setting_values), per explicit user
-- directive 2026-07-25: "all should be under system settings and we can
-- change on the settings page for all of them" -- these were previously
-- hardcoded arrays in web/lib/config/cascade.ts, requiring a redeploy to
-- retune. Each cascade is stored as a single json array of tiers, each tier
-- shaped { model, name, cost?, providerOrder? } matching CascadeItem.
--
-- Values below are the user's explicit 2026-07-25 spec, verified against
-- OpenRouter's real /models and /providers catalogs before writing (model
-- IDs and provider slugs below are all confirmed to exist on OpenRouter as
-- of this migration date -- see anthropic/claude-sonnet-5,
-- google/gemini-3.5-flash-lite, google/gemini-3.6-flash,
-- google/gemini-2.5-flash-lite, provider slugs cerebras/groq/baseten/
-- google-ai-studio/google-vertex/azure/anthropic).
--
-- cascade.stance is left byte-for-byte identical to the OLD cascade.analysis
-- (Haiku Vertex -> Haiku direct -> Sonnet 4.6 Nitro) intentionally: user said
-- "i dont remember what the stance cascade was for... i will tell you how to
-- adjust" once told what it does (docs/intelligence/relations-engine.md says
-- it was originally designed for fast/cheap non-reasoning models -- Gemini
-- Flash/Nemotron -- a drift from current behavior worth revisiting, but not
-- changed here pending explicit instruction).

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'cascade.chat',
    'system',
    'json',
    '{}'::jsonb,
    '[
      {"model": "openai/gpt-oss-120b", "name": "gpt-oss-120b (Cerebras)", "cost": 0.00035, "providerOrder": ["cerebras"]},
      {"model": "openai/gpt-oss-120b", "name": "gpt-oss-120b (Groq)", "cost": 0.00015, "providerOrder": ["groq"]},
      {"model": "openai/gpt-oss-120b", "name": "gpt-oss-120b (Baseten)", "cost": 0.00015, "providerOrder": ["baseten"]},
      {"model": "google/gemini-3.5-flash-lite", "name": "Gemini 3.5 Flash Lite (AI Studio)", "cost": 0.00025, "providerOrder": ["google-ai-studio"]},
      {"model": "google/gemini-3.5-flash-lite", "name": "Gemini 3.5 Flash Lite (Vertex)", "cost": 0.00025, "providerOrder": ["google-vertex"]}
    ]'::jsonb,
    'Chat LLM fallback cascade: array of {model, name, cost?, providerOrder?} tiers tried in order, primary first. Cerebras primary (2026-07-25: ~80% faster than Groq at higher per-token cost, user tradeoff decision).',
    'admin'
  ),
  (
    'cascade.analysis',
    'system',
    'json',
    '{}'::jsonb,
    '[
      {"model": "anthropic/claude-haiku-4.5", "name": "Claude Haiku 4.5 (Vertex)", "cost": 0.0015, "providerOrder": ["google-vertex"]},
      {"model": "anthropic/claude-haiku-4.5", "name": "Claude Haiku 4.5 (Anthropic Direct)", "cost": 0.0015, "providerOrder": ["anthropic"]},
      {"model": "anthropic/claude-haiku-4.5", "name": "Claude Haiku 4.5 (Azure)", "cost": 0.0015, "providerOrder": ["azure"]},
      {"model": "anthropic/claude-sonnet-5", "name": "Claude Sonnet 5 (Vertex)", "cost": 0.003, "providerOrder": ["google-vertex"]},
      {"model": "anthropic/claude-sonnet-5", "name": "Claude Sonnet 5 (Anthropic Direct)", "cost": 0.003, "providerOrder": ["anthropic"]}
    ]'::jsonb,
    'Video analysis (11-dimension) LLM fallback cascade: array of {model, name, cost?, providerOrder?} tiers. Haiku 4.5 across 3 providers before escalating to Sonnet 5 (user: Sonnet fallback is an accepted-but-unwanted cost, kept only because there is no other way to guarantee completion).',
    'admin'
  ),
  (
    'cascade.stance',
    'system',
    'json',
    '{}'::jsonb,
    '[
      {"model": "anthropic/claude-haiku-4.5", "name": "Claude Haiku 4.5 (Vertex/Bedrock)", "cost": 0.0015, "providerOrder": ["google-vertex", "amazon-bedrock"]},
      {"model": "anthropic/claude-haiku-4.5", "name": "Claude Haiku 4.5 (Anthropic Direct)", "cost": 0.0015},
      {"model": "anthropic/claude-sonnet-4.6:nitro", "name": "Claude Sonnet 4.6 (Nitro)", "cost": 0.003}
    ]'::jsonb,
    'Cross-dimension relations (tangent/contrarian) LLM fallback cascade for the knowledge graph. Deliberately left unchanged from its pre-registry values pending user review -- docs/intelligence/relations-engine.md originally specified fast/cheap non-reasoning models (Gemini Flash/Nemotron) for this task, a drift from what is actually configured here.',
    'admin'
  ),
  (
    'cascade.reasoning.free',
    'system',
    'json',
    '{}'::jsonb,
    '[
      {"model": "google/gemini-2.5-flash-lite", "name": "Gemini 2.5 Flash Lite"}
    ]'::jsonb,
    'Chat reasoning-mode LLM cascade for free tier users.',
    'admin'
  ),
  (
    'cascade.reasoning.proEnterprise',
    'system',
    'json',
    '{}'::jsonb,
    '[
      {"model": "openai/o3-mini", "name": "o3-mini (OpenAI)"},
      {"model": "google/gemini-3.6-flash", "name": "Gemini 3.6 Flash (AI Studio)", "providerOrder": ["google-ai-studio"]},
      {"model": "google/gemini-3.6-flash", "name": "Gemini 3.6 Flash (Vertex)", "providerOrder": ["google-vertex"]},
      {"model": "anthropic/claude-sonnet-5", "name": "Claude Sonnet 5 (Vertex)", "providerOrder": ["google-vertex"]}
    ]'::jsonb,
    'Chat reasoning-mode LLM cascade for pro/enterprise tier users.',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key in ('cascade.chat', 'cascade.analysis', 'cascade.stance', 'cascade.reasoning.free', 'cascade.reasoning.proEnterprise')
on conflict (setting_key, scope_type, scope_id) do nothing;
