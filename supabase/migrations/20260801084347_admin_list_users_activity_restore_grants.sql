-- cubic review fix (PR #175): CREATE FUNCTION defaults to EXECUTE granted to
-- PUBLIC (includes anon), silently undoing the REVOKE/GRANT pair that
-- 20260729225340_admin_user_activity_fix_ambiguity.sql explicitly added when
-- this function was first locked down. The DROP FUNCTION + CREATE FUNCTION
-- in 20260801081647 (required for the new return-type columns) wiped that
-- boundary -- the internal admin role check still blocks non-admin callers
-- from getting data, but anon should not be able to invoke this at all.
revoke all on function public.admin_list_users_activity() from public, anon;
grant execute on function public.admin_list_users_activity() to authenticated;
