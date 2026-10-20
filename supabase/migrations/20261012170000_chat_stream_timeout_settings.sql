-- Registers the Settings Registry keys for chat streaming timeouts (2026-10-12, T20).
-- Decouples the previously hardcoded 50s OpenRouter model timeout and client fetch timeout.
-- chat.stream.timeoutMs: Timeout per LLM model tier in worker streamChatCascade (default: 50000ms).
-- chat.stream.writingTimeoutMs: Timeout for creative writing requests (e.g. Haiku 5.5 blog/post generation, default: 90000ms).
-- NOT applied by the implementing agent (ADR 018/013: CI applies on merge).

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'chat.stream.timeoutMs',
    'system',
    'number',
    '{"min": 10000, "max": 180000}'::jsonb,
    '50000'::jsonb,
    'Timeout in milliseconds per model attempt during edge chat streaming (streamChatCascade).',
    'admin'
  ),
  (
    'chat.stream.writingTimeoutMs',
    'system',
    'number',
    '{"min": 10000, "max": 300000}'::jsonb,
    '90000'::jsonb,
    'Timeout in milliseconds for long-form creative writing chat requests (e.g. blog, LinkedIn post, script generation).',
    'admin'
  )
on conflict (key) do nothing;
