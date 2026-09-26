-- Seeds the stance-relations persistence Settings Registry keys (Cubic P3,
-- PR #322 run 3a5a4683): the code reads relations.persistMaxAttempts /
-- relations.persistRetryBaseDelayMs via SupabaseSettingsAdapter
-- .getRegistrySettings, but no setting_definitions rows existed, so the
-- values were silently served from RELATIONS_REGISTRY_FALLBACK
-- (web/lib/utils/relations-settings.ts) and not tunable in the admin UI.
-- Defaults here MUST stay in sync with RELATIONS_REGISTRY_FALLBACK.

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'relations.persistMaxAttempts',
    'system',
    'number',
    '{"min": 1, "max": 10}'::jsonb,
    '3'::jsonb,
    'Bounded retry attempts for the atomic analysis_payload key-merge (merge_analysis_payload_key RPC) used by the stance-relations route and backfill. On exhaustion the error is captured to Sentry and persistence degrades to Redis-only caching within its TTL.',
    'admin'
  ),
  (
    'relations.persistRetryBaseDelayMs',
    'system',
    'number',
    '{"min": 0, "max": 30000}'::jsonb,
    '250'::jsonb,
    'Base delay in milliseconds for the linear backoff between stance-relations persistence retry attempts (delay = base * attempt number).',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key in ('relations.persistMaxAttempts', 'relations.persistRetryBaseDelayMs')
on conflict (setting_key, scope_type, scope_id) do nothing;
