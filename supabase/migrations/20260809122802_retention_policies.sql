-- ADR 026 §6.5 (docs/private/ADR_026_GROUNDED_ENTITY_EXTRACTION_2026-08-09.md):
-- tiered, Settings-Registry-backed retention policy schema. Foundation only --
-- no enforcement workflow or UI yet, so Settings pages have something real to
-- build against later without a migration. Mirrors the RLS/access pattern
-- already established for setting_definitions in
-- 20260723090000_settings_registry_and_access_matrix.sql (authenticated-read,
-- service-role-write), rather than inventing a new access pattern.

create table if not exists public.retention_policies (
  id                      uuid primary key default gen_random_uuid(),
  tier                    text not null check (tier in ('free', 'light', 'casual', 'core', 'power', 'pro', 'enterprise', 'admin')),
  data_type               text not null,
  max_age_days            integer not null check (max_age_days > 0),
  last_accessed_cutoff_days integer check (last_accessed_cutoff_days is null or last_accessed_cutoff_days > 0),
  booster_pack_extendable boolean not null default false,
  description             text not null default '',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint retention_policies_tier_data_type_unique unique (tier, data_type)
);

comment on table public.retention_policies is
  'ADR 026 Phase 1: tiered retention policy per (tier, data_type). Schema/persistence only -- no enforcement job or UI reads/writes this yet. max_age_days is a hard ceiling; last_accessed_cutoff_days is an optional idle-eviction window (nullable = no idle eviction, only the age ceiling applies).';

create index if not exists idx_retention_policies_tier on public.retention_policies(tier);

alter table public.retention_policies enable row level security;

do $$
begin
  create policy "Authenticated users can read retention policies"
    on public.retention_policies
    for select
    using (auth.role() = 'authenticated');
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "Only service role can write retention policies"
    on public.retention_policies
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');
exception when duplicate_object then null;
end $$;

revoke all on public.retention_policies from anon, authenticated, public;
grant select on public.retention_policies to authenticated;
