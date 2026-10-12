-- Registers the Settings Registry key cascade.chatWriting (2026-10-12, T21).
-- resolveChatWritingCascade (web/lib/config/cascade.ts) routes creative-writing
-- chat requests (blog, LinkedIn, script, post...) to Haiku 5.5 on Vertex with
-- no reasoning effort. Default matches CHAT_WRITING_CASCADE_FALLBACK.
-- Carries the ADR 040 cascadeRegistry marker so the admin editor validates it.
-- NOT applied by the implementing agent (ADR 018/013: CI applies on merge).

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'cascade.chatWriting',
    'system',
    'json',
    '{"kind": "cascadeRegistry"}'::jsonb,
    '[
      {"model": "anthropic/claude-haiku-5.5", "name": "Claude Haiku 5.5 (Vertex)", "cost": 0.0015, "providerOrder": ["google-vertex"]},
      {"model": "anthropic/claude-haiku-5.5", "name": "Claude Haiku 5.5 (Anthropic Direct)", "cost": 0.0015, "providerOrder": ["anthropic"]},
      {"model": "openai/gpt-oss-120b", "name": "gpt-oss-120b (Groq)", "cost": 0.00015, "providerOrder": ["groq"]}
    ]'::jsonb,
    'Chat cascade for creative-writing requests (blog, LinkedIn, script, post...): array of {model, name, cost, providerOrder} tried in order.',
    'admin'
  )
on conflict (key) do nothing;
