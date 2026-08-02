-- Same vuln class as update_analysis_result_atomic (PR #179): both functions
-- take p_user_id as a plain parameter with no internal auth.uid() check, and
-- neither had the anon/authenticated revoke this project applies per-function
-- (20260602_revoke_anon_privileges.sql precedent) rather than via a blanket
-- default-privileges deny. Both are only ever called server-side via the
-- service-role client (SupabaseAnalysisAdapter.ts), so this revoke has no
-- app-facing effect -- it closes a live IDOR:
--   get_user_history_overview(p_user_id) -- any authenticated user could call
--     this directly via PostgREST with an arbitrary p_user_id and read another
--     user's full analysis history (title, channel, dimension coverage, status).
--   increment_analysis_view(p_analysis_id, p_user_id) -- lower severity (the
--     WHERE clause matches both id AND user_id, so it can't leak data), but a
--     caller could still spam view-count/last_viewed_at churn on rows it
--     doesn't own if it guesses id+user_id pairs.
revoke execute on function public.get_user_history_overview(uuid) from anon, authenticated, public;
revoke execute on function public.increment_analysis_view(uuid, uuid) from anon, authenticated, public;
