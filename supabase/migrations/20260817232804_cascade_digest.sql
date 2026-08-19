-- Dedicated LLM fallback cascade for the Dimension-0 executive digest pass
-- (GenerateExecutiveDigestUseCase), separately named/tunable from
-- cascade.chat -- until this migration, both digest routes
-- (web/app/api/analyses/digest/route.ts, web/app/api/webhooks/digest/route.ts)
-- called resolveChatCascade() with no dedicated key, contradicting the
-- standing "each helper function gets its own cascade" directive
-- (2026-07-25, same directive behind cascade.stance/cascade.entityExtraction
-- being split out of cascade.analysis).
--
-- Byte-for-byte same 3-provider gpt-oss-120b shape as cascade.chat, but
-- reordered Groq-primary / Cerebras-fallback per explicit user directive
-- 2026-08-17: "the reason I insisted on making Cerebras number one in the
-- chat cascade was because I insist on having super fast responses in the
-- chat use case... [digest] is running in the midst of everything else and
-- a few seconds more or less will not make a difference... instead of
-- Cerebras, we can make it Groq, which makes it cheaper and quite fast as
-- well." Model stays openai/gpt-oss-120b; Baseten kept as third-tier
-- fallback, matching cascade.chat's existing shape.

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'cascade.digest',
    'system',
    'json',
    '{}'::jsonb,
    '[
      {"model": "openai/gpt-oss-120b", "name": "gpt-oss-120b (Groq)", "cost": 0.00015, "providerOrder": ["groq"]},
      {"model": "openai/gpt-oss-120b", "name": "gpt-oss-120b (Cerebras)", "cost": 0.00035, "providerOrder": ["cerebras"]},
      {"model": "openai/gpt-oss-120b", "name": "gpt-oss-120b (Baseten)", "cost": 0.00015, "providerOrder": ["baseten"]}
    ]'::jsonb,
    'Dimension-0 executive digest LLM fallback cascade: array of {model, name, cost?, providerOrder?} tiers tried in order, primary first. Groq primary (2026-08-17: digest runs in the background, so chat''s speed-first Cerebras-primary tradeoff does not apply -- Groq is cheaper and still fast). Dedicated from cascade.chat so OpenRouter cost logs separate digest spend from live chat spend, per the "each helper function gets its own cascade" standing directive.',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key = 'cascade.digest'
on conflict (setting_key, scope_type, scope_id) do nothing;
