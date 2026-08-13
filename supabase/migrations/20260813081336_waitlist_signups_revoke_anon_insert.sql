-- Ultrareview finding: anon had table-level INSERT with no column allowlist,
-- so a caller could forge id/created_at or spoof source='cli_verification'.
-- Insert now moves server-side (web/app/api/waitlist/route.ts, service_role),
-- so anon needs zero privileges on this table.
drop policy if exists "anon can insert waitlist signups" on public.waitlist_signups;
revoke insert on public.waitlist_signups from anon;
revoke all on public.waitlist_signups from anon, authenticated, public;
