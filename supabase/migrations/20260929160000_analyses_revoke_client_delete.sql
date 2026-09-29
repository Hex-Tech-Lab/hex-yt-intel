-- Close a quota bypass left open by 20260929140000_analyses_column_grants_lockdown.sql.
--
-- reserve_analysis_quota counts a user's analyses rows with billing_status =
-- 'completed' created this month (free tier limit 3). `authenticated` still
-- held DELETE on public.analyses and the analyses_delete_own RLS policy
-- allows owners to delete their own rows, so a free user could delete their
-- completed rows directly with the public anon key + their session and reset
-- their monthly quota to zero (unlimited free analyses). R1c closed the
-- equivalent UPDATE trick (billing_status -> 'failed'); this closes DELETE.
--
-- Nothing in the app deletes analyses rows through a user-session client
-- (verified 2026-09-29: no DELETE route, adapter or browser call targets
-- public.analyses; service_role cleanup such as delete-old-free-analyses is
-- unaffected). A future "delete my analysis" feature must go through a server
-- route that preserves quota accounting (e.g. a soft delete), not this grant.
--
-- The analyses_delete_own policy is left in place: without the DELETE grant it
-- has no effect, and a grant change keeps this migration minimal.

revoke delete on public.analyses from authenticated;
