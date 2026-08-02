-- RCA (2026-08-02, live user report): admin/users showed "Last session:
-- Jul 19" for a user with confirmed activity 5 minutes prior (verified:
-- max(auth.sessions.updated_at) = 2026-08-02 20:15:01 UTC for this user).
--
-- Root cause: the `s` lateral subquery selected `sessions.created_at as
-- last_session_at` and ordered `by sessions.created_at desc` -- i.e. it
-- picked the session ROW that was CREATED most recently, not the one most
-- recently USED. Supabase auth reuses the same session row across token
-- refreshes (updating `updated_at`, not creating a new row), so a session
-- created weeks ago that's still being actively refreshed today has an old
-- created_at but a current updated_at. Ordering/selecting by created_at
-- picked stale rows whenever an older-but-still-active session existed
-- alongside newer, already-expired ones.
--
-- Fix: order by and select `updated_at` instead -- that's the column that
-- actually reflects "last used," which is what "Last session" claims to show.
--
-- Using `create or replace` (not drop+create) to preserve the EXECUTE
-- grants restored by 20260801084347.
create or replace function public.admin_list_users_activity()
returns table(
  id uuid,
  email text,
  name text,
  tier text,
  role text,
  created_at timestamptz,
  analyses_count bigint,
  last_analysis_at timestamptz,
  last_session_at timestamptz,
  last_session_ip text,
  last_session_user_agent text,
  total_cost_usd numeric,
  total_tokens_used bigint
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not exists (
    select 1 from public.users where public.users.id = auth.uid() and public.users.role = 'admin'
  ) then
    raise exception 'forbidden';
  end if;

  return query
  select
    u.id,
    u.email,
    u.name,
    u.tier,
    u.role,
    u.created_at,
    coalesce(a.analyses_count, 0) as analyses_count,
    a.last_analysis_at,
    s.last_session_at,
    s.last_session_ip,
    s.last_session_user_agent,
    coalesce(c.total_cost_usd, 0) as total_cost_usd,
    coalesce(c.total_tokens_used, 0) as total_tokens_used
  from public.users u
  left join lateral (
    select count(*) as analyses_count, max(analyses.created_at) as last_analysis_at
    from public.analyses
    where analyses.user_id = u.id
  ) a on true
  left join lateral (
    select sessions.updated_at as last_session_at, sessions.ip::text as last_session_ip, sessions.user_agent as last_session_user_agent
    from auth.sessions
    where sessions.user_id = u.id
    order by sessions.updated_at desc
    limit 1
  ) s on true
  left join lateral (
    select sum(cost_usd) as total_cost_usd, sum(tokens_used) as total_tokens_used
    from public.usage_logs
    where usage_logs.user_id = u.id
      and usage_logs.action in ('analysis_completed', 'dimension_remediation')
  ) c on true
  order by u.created_at desc;
end;
$$;
