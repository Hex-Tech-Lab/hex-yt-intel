-- cascade.stance previously aliased cascade.analysis's (old) values with no
-- independent reasoning behind that -- user confirmed 2026-07-25: "of course
-- no reason." Real-world evidence from this same session: OpenRouter activity
-- logs showed the relations/stance engine's ~1263-token prompt (matches
-- relations-engine.ts buildPrompt's dimension roster) occasionally landing on
-- the pricier Sonnet tier, exactly the pattern the user reported seeing.
--
-- New spec: gpt-oss-120b across the same 3 providers as the ORIGINAL (pre-
-- 2026-07-25) chat cascade order (Groq -> Vertex -> Cerebras) -- "cut off"
-- there, i.e. no further fallback into a different/heavier model family --
-- then ONE more tier on a similarly fast/cheap model instead of Gemini Flash
-- Lite. meta-llama/llama-3.3-70b-instruct on Groq verified live 2026-07-25
-- (Groq LPU throughput, comparable cost to gpt-oss-120b, confirmed available
-- via OpenRouter's /models/{id}/endpoints).

update public.setting_definitions
set default_value = '[
      {"model": "openai/gpt-oss-120b", "name": "gpt-oss-120b (Groq)", "cost": 0.00015, "providerOrder": ["groq"]},
      {"model": "openai/gpt-oss-120b", "name": "gpt-oss-120b (Vertex)", "cost": 0.00015, "providerOrder": ["google-vertex"]},
      {"model": "openai/gpt-oss-120b", "name": "gpt-oss-120b (Cerebras)", "cost": 0.00035, "providerOrder": ["cerebras"]},
      {"model": "meta-llama/llama-3.3-70b-instruct", "name": "Llama 3.3 70B (Groq)", "cost": 0.0000004, "providerOrder": ["groq"]}
    ]'::jsonb,
    description = 'Cross-dimension relations (tangent/contrarian) LLM fallback cascade for the knowledge graph. gpt-oss-120b across 3 providers (cheap, fast, sufficient for this classification-style task per user 2026-07-25), then Llama 3.3 70B on Groq instead of a heavier/pricier model -- deliberately does NOT escalate into Haiku/Sonnet.',
    updated_at = now()
where key = 'cascade.stance';

update public.setting_values
set value = (select default_value from public.setting_definitions where key = 'cascade.stance'),
    updated_at = now()
where setting_key = 'cascade.stance' and scope_type = 'system' and scope_id is null;
