-- Wave D1: Settings registry + rights matrix.
--
-- Motivation (see docs/history/RCA_2026-07-23_WHY_CONTRACT_AUDIT_MISSED_KG_SCALE_BUG.md):
-- value-domain contracts (numeric ranges, enums, length limits) currently live as
-- hardcoded literals scattered across Zod validators, prompt files, and UI
-- normalization code with no single source of truth -- exactly the condition that let
-- the KG weight/strength schema (0-1) silently drift from the prompt's documented
-- range (1-10) for an unknown period. This migration adds a generic, extensible
-- catalog (setting_definitions) so a "contract" like kg.weight.max is ONE row read by
-- every consumer, plus a role-based rights matrix granular to page/form/field, not
-- just per-table RLS.
--
-- Existing tables this complements (unchanged by this migration):
--   - app_settings   (20260605120000): generic service-role-only KV, currently used
--                     for model_config. Becomes the 'system' tier's value store.
--   - admin_settings (20260712): fixed-column singleton. Left as-is; new
--     system/admin-tier settings should be added via setting_definitions +
--     setting_values below rather than new admin_settings columns going forward.
--   - user_settings  (20260712): fixed-column per-user. Same guidance for new
--     user-tier settings.
--   - users.role     (20260521203314): 'user' | 'admin' | 'moderator' -- the role
--     vocabulary this matrix keys off.

-- ============================================================================
-- 1. setting_definitions: the comprehensive catalog / single source of truth
-- ============================================================================
create table if not exists public.setting_definitions (
  key           text primary key,
  tier          text not null check (tier in ('system', 'admin', 'user')),
  data_type     text not null check (data_type in ('number', 'string', 'boolean', 'enum', 'json', 'array')),
  -- { min?, max?, enumValues?, regex?, minLength?, maxLength? } -- the numeric/shape
  -- contract every consumer (Zod schema, prompt-generation, UI form) should read
  -- from, instead of re-hardcoding the same bound independently.
  validation    jsonb not null default '{}'::jsonb,
  default_value jsonb not null,
  description   text not null,
  -- Baseline role required to know this setting exists at all. Fine-grained
  -- read/write per role/surface is settings_access_matrix below; this is the floor.
  owner_role    text not null default 'admin' check (owner_role in ('user', 'admin', 'moderator', 'system')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.setting_definitions is
  'Catalog of every configurable value-domain contract (numeric ranges, enums, lengths). One row per setting key, read by validators/prompts/UI instead of independently hardcoded literals.';

-- ============================================================================
-- 2. setting_values: actual values per scope
-- ============================================================================
create table if not exists public.setting_values (
  id           uuid primary key default gen_random_uuid(),
  setting_key  text not null references public.setting_definitions(key) on delete cascade,
  scope_type   text not null check (scope_type in ('system', 'admin', 'user')),
  -- NULL for system/admin singleton scope; a user_id for user-tier overrides.
  scope_id     uuid,
  value        jsonb not null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id),
  -- One value per (key, scope_type, scope_id) -- NULLS NOT DISTINCT so the
  -- system/admin singleton (scope_id null) is also uniquely constrained.
  constraint setting_values_scope_unique unique nulls not distinct (setting_key, scope_type, scope_id)
);

comment on table public.setting_values is
  'Actual values for each setting_definitions row, scoped to system (singleton), admin (singleton), or a specific user.';

create index if not exists idx_setting_values_key on public.setting_values(setting_key);
create index if not exists idx_setting_values_scope on public.setting_values(scope_type, scope_id);

-- ============================================================================
-- 3. settings_access_matrix: rights matrix, granular to page/form/field
-- ============================================================================
create table if not exists public.settings_access_matrix (
  id            uuid primary key default gen_random_uuid(),
  role          text not null check (role in ('user', 'admin', 'moderator', 'system')),
  surface_type  text not null check (surface_type in ('page', 'form', 'field', 'setting')),
  -- e.g. 'admin/settings' (page), 'model-cascade-form' (form), 'kg.weight.max' (field/setting)
  surface_id    text not null,
  -- Set when the grant targets a specific setting (field/setting-level); null for
  -- page/form-level grants that aren't tied to one particular setting key.
  setting_key   text references public.setting_definitions(key) on delete cascade,
  permission    text not null check (permission in ('hidden', 'read', 'write')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint settings_access_matrix_unique unique nulls not distinct (role, surface_type, surface_id, setting_key)
);

comment on table public.settings_access_matrix is
  'Role-based rights matrix for settings, granular to page/form/field. Enforced by the settings API route layer (Postgres RLS cannot practically do field-level checks) -- RLS below is the coarse per-row net; this table is the data the route queries before filtering what it returns/accepts.';

create index if not exists idx_settings_access_matrix_role on public.settings_access_matrix(role, surface_type, surface_id);

-- ============================================================================
-- 4. RLS -- coarse row-level net; matches the existing app_settings pattern
-- ============================================================================
alter table public.setting_definitions enable row level security;
alter table public.setting_values enable row level security;
alter table public.settings_access_matrix enable row level security;

-- setting_definitions: readable by any authenticated user (the catalog itself is
-- not secret -- it's metadata about what settings exist), writable only by
-- service_role. Per-role visibility of *which* definitions a given role should
-- see is enforced by the API route via settings_access_matrix, not by RLS here.
do $$
begin
  create policy "Authenticated users can read setting definitions"
    on public.setting_definitions
    for select
    using (auth.role() = 'authenticated');
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "Only service role can write setting definitions"
    on public.setting_definitions
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');
exception when duplicate_object then null;
end $$;

-- setting_values: users can read/write only their own user-scoped rows directly.
-- system/admin-scoped rows (scope_id is null) are service_role only -- same
-- reasoning as app_settings: the admin settings page must go through a server
-- route using the service client, never direct browser access.
do $$
begin
  create policy "Users can read their own setting values"
    on public.setting_values
    for select
    using (scope_type = 'user' and scope_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "Users can write their own setting values"
    on public.setting_values
    for insert
    with check (scope_type = 'user' and scope_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "Users can update their own setting values"
    on public.setting_values
    for update
    using (scope_type = 'user' and scope_id = auth.uid())
    with check (scope_type = 'user' and scope_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "Service role can manage all setting values"
    on public.setting_values
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');
exception when duplicate_object then null;
end $$;

-- settings_access_matrix: the matrix itself is server-only -- no client should
-- ever query it directly (the settings API route does, using the service client).
do $$
begin
  create policy "Service role can manage the access matrix"
    on public.settings_access_matrix
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');
exception when duplicate_object then null;
end $$;

-- ============================================================================
-- 5. Seed: the exact contract that caused tonight's incident, as the first entry
-- ============================================================================
insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'kg.node.weight',
    'system',
    'number',
    '{"min": 1, "max": 10}'::jsonb,
    '5'::jsonb,
    'Knowledge-graph node importance weight. Must match the range documented in web/lib/prompts/ucis-v5.1.ts ("weight: Importance (1-10)") and enforced in web/lib/validators/synthesis.ts KGNodeSchema.',
    'system'
  ),
  (
    'kg.edge.strength',
    'system',
    'number',
    '{"min": 1, "max": 10}'::jsonb,
    '5'::jsonb,
    'Knowledge-graph edge connection strength. Must match the range documented in web/lib/prompts/ucis-v5.1.ts ("strength: Connection strength (1-10)") and enforced in web/lib/validators/synthesis.ts KGEdgeSchema.',
    'system'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
values
  ('kg.node.weight', 'system', null, '{"min": 1, "max": 10}'::jsonb),
  ('kg.edge.strength', 'system', null, '{"min": 1, "max": 10}'::jsonb)
on conflict (setting_key, scope_type, scope_id) do nothing;
