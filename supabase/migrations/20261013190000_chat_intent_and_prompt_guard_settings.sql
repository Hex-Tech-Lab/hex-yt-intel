-- Migration: 20261013190000_chat_intent_and_prompt_guard_settings.sql
-- Registers Settings Registry keys for ADR-043 (Chat Intent Routing & Prompt Guard Screen)
-- Gated behind feature flags: chat.intent.enabled (default: false) and chat.promptGuard.mode (default: 'off')
-- NOT applied by the implementing agent (ADR 018/013: applied by CI on merge).

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'chat.intent.enabled',
    'system',
    'boolean',
    '{}'::jsonb,
    'false'::jsonb,
    'Feature flag enabling Jev-based chat intent classification and dynamic prompt/routing gating.',
    'admin'
  ),
  (
    'chat.intent.overrideConfidence',
    'system',
    'number',
    '{"min": 0.0, "max": 1.0}'::jsonb,
    '0.75'::jsonb,
    'Minimum confidence score required for Jev to override the prior turn intent during follow-up messages.',
    'admin'
  ),
  (
    'chat.intent.timeoutMs',
    'system',
    'number',
    '{"min": 1000, "max": 30000}'::jsonb,
    '15000'::jsonb,
    'Timeout in milliseconds for Jev chat intent classification Decisions call.',
    'admin'
  ),
  (
    'chat.intent.modelByIntent',
    'system',
    'json',
    '{}'::jsonb,
    '{"writing": "primary", "comments_lookup": "cheap", "citation_lookup": "cheap", "metadata": "cheap", "general_grounded_qa": "primary"}'::jsonb,
    'Model-tier routing mapping by classified chat intent.',
    'admin'
  ),
  (
    'chat.promptGuard.mode',
    'system',
    'string',
    '{"enum": ["off", "flag", "block"]}'::jsonb,
    '"off"'::jsonb,
    'Operational mode for Groq Llama Prompt Guard screening (off: bypassed, flag: annotate telemetry only, block: reject turn).',
    'admin'
  ),
  (
    'chat.promptGuard.model',
    'system',
    'string',
    '{"enum": ["meta-llama/llama-prompt-guard-2-86m", "meta-llama/llama-prompt-guard-2-22m"]}'::jsonb,
    '"meta-llama/llama-prompt-guard-2-86m"'::jsonb,
    'Groq model used for input prompt injection & jailbreak screening.',
    'admin'
  ),
  (
    'chat.promptGuard.maxAttackScore',
    'system',
    'number',
    '{"min": 0.0, "max": 1.0}'::jsonb,
    '0.85'::jsonb,
    'Threshold probability score above which input is flagged or blocked as prompt injection/jailbreak.',
    'admin'
  ),
  (
    'chat.promptGuard.timeoutMs',
    'system',
    'number',
    '{"min": 500, "max": 10000}'::jsonb,
    '5000'::jsonb,
    'Timeout in milliseconds for Groq Prompt Guard screening API call.',
    'admin'
  ),
  (
    'chat.promptGuard.gatesAccepted',
    'system',
    'boolean',
    '{}'::jsonb,
    'false'::jsonb,
    'Safety interlock requiring explicit ADR 043 rollout sign-off before block mode can activate.',
    'admin'
  )
on conflict (key) do nothing;
