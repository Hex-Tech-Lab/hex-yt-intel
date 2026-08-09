-- Follow-up to 20260809122802_retention_policies.sql per Cubic's post-merge
-- review of PR #226. Two of Cubic's findings hold up on inspection (the P0
-- service_role-grant claim did not -- verified live via pg_default_acl +
-- information_schema.role_table_grants; service_role already has full
-- privileges via Supabase's default ACL for public, untouched by that
-- migration's revoke, same as every other service-role-accessed table here):
--
-- 1. updated_at was never set on UPDATE, only on INSERT (default now()).
--    public.update_updated_at_column() already exists (baseline migration,
--    20260514000000) but had zero real callers anywhere in this schema --
--    this is its first real usage, not a copy of an existing pattern, since
--    grep found no CREATE TRIGGER referencing it anywhere.
-- 2. idx_retention_policies_tier is redundant: the unique constraint on
--    (tier, data_type) already creates a btree index with tier as its
--    leading column, which Postgres can use directly for tier-only lookups.

drop trigger if exists trg_retention_policies_updated_at on public.retention_policies;
create trigger trg_retention_policies_updated_at
  before update on public.retention_policies
  for each row execute function public.update_updated_at_column();

drop index if exists public.idx_retention_policies_tier;
