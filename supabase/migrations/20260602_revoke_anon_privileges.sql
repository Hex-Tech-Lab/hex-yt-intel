-- 20260602_revoke_anon_privileges.sql
-- Security hardening: lock SECURITY DEFINER quota functions and stripe_events to
-- server-side only. PAIRED with the code change migrating privileged backend ops
-- from the anon client to getSupabaseServiceClient() (commit fix(security): ...).
--
-- ⚠️ APPLY ONLY AFTER the new server code is deployed to Vercel. Revoking anon while
-- the old (anon-client) code is live would break quota + webhooks (race-condition
-- outage).
--
-- NOTE: service_role bypasses RLS, but NOT function EXECUTE grants. Functions default
-- EXECUTE to PUBLIC; revoking from PUBLIC also strips service_role (it inherits via
-- PUBLIC). So GRANT EXECUTE TO service_role explicitly BEFORE revoking from PUBLIC.

-- ── Quota functions: server-side (service_role) only ────────────────────────────
GRANT EXECUTE ON FUNCTION public.increment_user_quota_atomic(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.increment_user_quota_atomic(uuid) FROM anon, authenticated, public;

GRANT EXECUTE ON FUNCTION public.decrement_user_quota(uuid, integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.decrement_user_quota(uuid, integer) FROM anon, authenticated, public;

GRANT EXECUTE ON FUNCTION public.increment_user_quota(uuid, integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.increment_user_quota(uuid, integer) FROM anon, authenticated, public;

GRANT EXECUTE ON FUNCTION public.reset_user_quota(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.reset_user_quota(uuid) FROM anon, authenticated, public;

-- ── Trigger / maintenance functions: never RPC-callable by web roles ─────────────
-- (These run via triggers / pg_cron, which do not require an invoker EXECUTE grant,
--  so revoking from web roles does not affect their normal operation.)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.delete_old_free_analyses() FROM anon, authenticated, public;

-- ── stripe_events: webhook (now service_role) only ───────────────────────────────
-- Drop the permissive ALL/USING(true) policy. With RLS enabled and no policy,
-- anon/authenticated get default-deny; service_role bypasses RLS entirely, so the
-- webhook retains full access.
DROP POLICY IF EXISTS "Service role can manage stripe events" ON public.stripe_events;

-- search_analyses_semantic is intentionally left callable by authenticated (user-facing
-- search) and is not SECURITY DEFINER. The vector extension move (extension_in_public)
-- is deliberately deferred — search_analyses_semantic(vector,...) resolves it via public.
