-- RCA (2026-08-29, live-DB-verified): GET /api/admin/users failed with
-- [42501] permission denied for function admin_list_users_activity.
-- Live information_schema.role_routine_grants showed EXECUTE granted ONLY to
-- service_role and postgres -- the `authenticated` grant that
-- 20260801084347_admin_list_users_activity_restore_grants.sql explicitly
-- applied is absent from the live database (grants drift: drop/create or a
-- raw-DDL re-apply resets grants to defaults -- the same failure class as
-- ADR 018's addendum). The /api/admin/users route deliberately calls this
-- RPC with the CALLER's authenticated client (not the service role -- the
-- function's internal admin check reads auth.uid(), which is NULL under the
-- service role and would always raise 'forbidden'), so the missing
-- `authenticated` grant IS the 42501.
--
-- The function itself already has the right posture
-- (20260802201937): security definer + set search_path + internal
-- users.role='admin' check, so granting EXECUTE to authenticated is safe.
-- The SECURITY DEFINER attribute is re-asserted via ALTER (idempotent --
-- sets the same state) per the 2026-08-29 master dispatch directive.
--
-- Per ADR 018: after applying, verify with:
--   pnpm exec supabase db push --dry-run
-- and confirm the remote records this version (filename must match the
-- recorded version exactly).

revoke all on function public.admin_list_users_activity() from public, anon;
grant execute on function public.admin_list_users_activity() to authenticated, service_role;
alter function public.admin_list_users_activity() security definer;