-- RCA: /admin/users has been throwing "Failed to load users: Failed to load
-- users" (doubled generic message, see route.ts/UsersAdminClient.tsx) since
-- at least 20260729222920. The prior "fix_ambiguity" migration
-- (20260729225340) did NOT actually fix this -- it left the real bug in
-- place. Root cause: `returns table(..., created_at timestamptz, ...)`
-- implicitly declares a plpgsql variable named `created_at` in the function
-- body's scope. The LATERAL subqueries below reference bare `created_at`
-- (max(created_at), `created_at as last_session_at`, `order by created_at
-- desc`), which Postgres then can't disambiguate between that OUT-parameter
-- variable and the table column of the same name -- raising "column
-- reference \"created_at\" is ambiguous" (confirmed live via
-- get_logs(postgres), 2026-08-02 20:15:49 UTC). Running the identical SQL
-- standalone (outside the plpgsql function) does NOT reproduce this --
-- proof it's the OUT-param shadowing, not a genuine multi-table ambiguity.
--
-- Fix: fully qualify every created_at reference inside the LATERAL
-- subqueries to their source table, matching the qualification style
-- already used for `u.created_at` elsewhere in this function.
--
-- Using `create or replace` (not drop+create) to preserve the EXECUTE
-- grants restored by 20260801084347 -- see that migration's comment for why
-- drop+create silently resets grants to PUBLIC.
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
    select sessions.created_at as last_session_at, sessions.ip::text as last_session_ip, sessions.user_agent as last_session_user_agent
    from auth.sessions
    where sessions.user_id = u.id
    order by sessions.created_at desc
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
