-- Admin User Activity dashboard: exposes auth.sessions (not in PostgREST's
-- exposed schema list, so unreachable from the JS client directly) through
-- two SECURITY DEFINER RPCs. Both check `public.users.role = 'admin'` for
-- the CALLING user internally -- defense in depth alongside the existing
-- requireAdmin() gate in the API route, since a SECURITY DEFINER function
-- runs with the *owner's* privileges regardless of caller RLS.
--
-- Context: 2026-07-30, investigating an unexplained login from a
-- pre-launch/unadvertised app (docs/for_sharing/sattam...json). No standing
-- way existed to see "who signed up, what did they look at, did they
-- download a report" -- this migration is the data layer for that.

create or replace function public.admin_list_users_activity()
returns table (
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
  last_session_user_agent text
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
    s.last_session_user_agent
  from public.users u
  left join lateral (
    select count(*) as analyses_count, max(created_at) as last_analysis_at
    from public.analyses
    where analyses.user_id = u.id
  ) a on true
  left join lateral (
    select created_at as last_session_at, ip::text as last_session_ip, user_agent as last_session_user_agent
    from auth.sessions
    where sessions.user_id = u.id
    order by created_at desc
    limit 1
  ) s on true
  order by u.created_at desc;
end;
$$;

create or replace function public.admin_get_user_sessions(target_user_id uuid)
returns table (
  id uuid,
  created_at timestamptz,
  not_after timestamptz,
  ip text,
  user_agent text
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
  select s.id, s.created_at, s.not_after, s.ip::text, s.user_agent
  from auth.sessions s
  where s.user_id = target_user_id
  order by s.created_at desc;
end;
$$;

revoke all on function public.admin_list_users_activity() from public, anon;
revoke all on function public.admin_get_user_sessions(uuid) from public, anon;
grant execute on function public.admin_list_users_activity() to authenticated;
grant execute on function public.admin_get_user_sessions(uuid) to authenticated;
