-- Dub.co short-link config + TestSprite auth-bypass toggle, both moved into the
-- Settings Registry (setting_definitions/setting_values, base schema:
-- 20260723090000_settings_registry_and_access_matrix.sql) per explicit user
-- directive: "this is supposed to be configuration-based, persistent in the
-- database, part of the settings registry, and exposed on the set exposures,
-- just like everything else." Follows the exact resolve-with-fallback shape
-- web/lib/config/cascade.ts already established for cascade.* keys.
--
-- Also adds a generic activity_log table so the TestSprite bypass (and Dub
-- share-link creation) has a real, queryable usage trail instead of being
-- silent -- grepped first for an existing generic activity table and found
-- none (only domain-specific logs like usage_logs/waitlist tables).

-- ============================================================================
-- 1. New setting_definitions + setting_values rows
-- ============================================================================
insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'dub.domain',
    'system',
    'string',
    '{"maxLength": 255}'::jsonb,
    '"go.getvintel.com"'::jsonb,
    'Dub.co short-link domain used to wrap public /share/<token> URLs. Must match a domain actually configured in the Dub dashboard workspace.',
    'admin'
  ),
  (
    'dub.enabled',
    'system',
    'boolean',
    '{}'::jsonb,
    'true'::jsonb,
    'Master toggle for Dub.co short-link creation on the /api/analyses/[id]/share route. When false, share always falls back to the raw un-shortened share URL without calling the Dub API.',
    'admin'
  ),
  (
    'testAuthBypass.enabled',
    'system',
    'boolean',
    '{}'::jsonb,
    'false'::jsonb,
    'Master toggle for the TestSprite auth-bypass route (/api/test-auth/login). Must be true AND the request must supply the matching TEST_AUTH_BYPASS_SECRET header for the bypass to work -- defaults OFF (security-sensitive, off-by-default even if the env secret happens to be configured).',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
values
  ('dub.domain', 'system', null, '"go.getvintel.com"'::jsonb),
  ('dub.enabled', 'system', null, 'true'::jsonb),
  ('testAuthBypass.enabled', 'system', null, 'false'::jsonb)
on conflict (setting_key, scope_type, scope_id) do nothing;

-- ============================================================================
-- 2. activity_log: generic activity trail (dub_share, testsprite_bypass, ...)
-- ============================================================================
create table if not exists public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  category    text not null,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.activity_log is
  'Generic append-only activity trail for events that need a real audit record but don''t warrant their own dedicated table -- e.g. dub_share (Dub short-link created), testsprite_bypass (successful TestSprite auth-bypass login). Never store secrets in detail.';

create index if not exists idx_activity_log_category on public.activity_log(category);
create index if not exists idx_activity_log_created_at on public.activity_log(created_at desc);

alter table public.activity_log enable row level security;

-- Write: service-role only (route handlers always use the service client for
-- this -- same pattern as setting_values' system/admin-scope rows).
do $$
begin
  create policy "Service role can write activity log"
    on public.activity_log
    for insert
    with check (auth.role() = 'service_role');
exception when duplicate_object then null;
end $$;

-- Read: admin role only. users.role drives this (20260521203314), mirrored via
-- a subquery against public.users rather than a JWT claim since role isn't
-- currently mirrored into auth.jwt() claims in this project.
do $$
begin
  create policy "Admins can read activity log"
    on public.activity_log
    for select
    using (
      exists (
        select 1 from public.users
        where public.users.id = auth.uid()
          and public.users.role = 'admin'
      )
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "Service role can read activity log"
    on public.activity_log
    for select
    using (auth.role() = 'service_role');
exception when duplicate_object then null;
end $$;
