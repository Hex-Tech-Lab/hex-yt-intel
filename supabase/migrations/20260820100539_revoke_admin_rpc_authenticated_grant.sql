-- Real finding from Supabase's own database linter (2026-08-20,
-- authenticated_security_definer_function_executable): admin_get_user_sessions
-- and admin_list_users_activity are SECURITY DEFINER functions that had
-- EXECUTE still granted to the `authenticated` role (Postgres's default
-- grant-to-PUBLIC-then-inherited-by-authenticated behavior -- same class of
-- gap as the CLAUDE.md-documented `update_analysis_result_atomic`/
-- `get_user_history_overview` incidents this project already caught before).
--
-- Verified NOT currently exploitable: both functions already have a real
-- internal `role = 'admin'` check that raises an exception for any
-- non-admin caller (checked via pg_get_functiondef before this migration).
-- This is defense-in-depth, matching the project's established pattern
-- (20260602_revoke_anon_privileges.sql precedent) of explicit per-function
-- REVOKE rather than relying solely on internal logic to gate access.
revoke execute on function public.admin_get_user_sessions(uuid) from authenticated, anon, public;
revoke execute on function public.admin_list_users_activity() from authenticated, anon, public;
