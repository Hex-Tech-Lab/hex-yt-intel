-- app_settings: generic server-only key/value configuration (JSONB).
--
-- First consumer: the `model_config` row — per-tier LLM cascades for chat + analysis,
-- so the model selection is DB-driven instead of hardcoded. Deliberately a GENERIC
-- key/value table (not a single model_config column): future config such as
-- `stripe_products` becomes its OWN row, never folded into model_config (domain SoC).
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb        not null,
  updated_at  timestamptz  not null default now()
);

comment on table public.app_settings is
  'Server-only key/value app configuration (JSONB). Read via the service role by the bouncer; the future admin settings page edits rows. RLS-locked with no permissive policy -> only service_role (which bypasses RLS) can access it.';

-- RLS enabled with NO permissive policy = the table is locked to service_role only
-- (service_role bypasses RLS; normal authenticated/anon clients see zero rows). The
-- admin settings page must read/write through a server route using the service client,
-- never directly from the browser.
alter table public.app_settings enable row level security;

-- Seed model_config from the CURRENT hardcoded production defaults:
--   chat     (web/lib/config/prompts.ts CHAT_MODELS):  gemini-flash:free, nemotron:free
--   analysis (worker LLMCascade MODEL_CHAIN): nemotron:free -> glm:free -> gemma:free -> claude-haiku-4.5
--
-- testOverride.enabled = true is the "switch Haiku on for now" global test toggle:
-- Haiku 4.5 leads both paths with a free fallback so it degrades gracefully if the
-- OpenRouter balance runs out. Flip enabled -> false to fall back to per-plan routing.
insert into public.app_settings (key, value)
values (
  'model_config',
  jsonb_build_object(
    'version', 1,
    'plans', jsonb_build_object(
      'free', jsonb_build_object(
        'chat', jsonb_build_array(
          'google/gemini-2.0-flash-exp:free',
          'nvidia/nemotron-3-nano-30b-a3b:free'
        ),
        'analysis', jsonb_build_array(
          'nvidia/nemotron-3-nano-30b-a3b:free',
          'z-ai/glm-4.5-air:free',
          'google/gemma-4-26b-a4b-it:free',
          'anthropic/claude-haiku-4.5'
        )
      ),
      'pro', jsonb_build_object(
        'chat', jsonb_build_array(
          'anthropic/claude-haiku-4.5',
          'google/gemini-2.0-flash-exp:free',
          'nvidia/nemotron-3-nano-30b-a3b:free'
        ),
        'analysis', jsonb_build_array(
          'anthropic/claude-haiku-4.5',
          'nvidia/nemotron-3-nano-30b-a3b:free',
          'z-ai/glm-4.5-air:free',
          'google/gemma-4-26b-a4b-it:free'
        )
      ),
      'enterprise', jsonb_build_object(
        'chat', jsonb_build_array(
          'anthropic/claude-haiku-4.5',
          'google/gemini-2.0-flash-exp:free',
          'nvidia/nemotron-3-nano-30b-a3b:free'
        ),
        'analysis', jsonb_build_array(
          'anthropic/claude-haiku-4.5',
          'nvidia/nemotron-3-nano-30b-a3b:free',
          'z-ai/glm-4.5-air:free',
          'google/gemma-4-26b-a4b-it:free'
        )
      )
    ),
    'testOverride', jsonb_build_object(
      'enabled', true,
      'chat', jsonb_build_array(
        'anthropic/claude-haiku-4.5',
        'google/gemini-2.0-flash-exp:free'
      ),
      'analysis', jsonb_build_array(
        'anthropic/claude-haiku-4.5',
        'nvidia/nemotron-3-nano-30b-a3b:free'
      )
    )
  )
)
on conflict (key) do nothing;
