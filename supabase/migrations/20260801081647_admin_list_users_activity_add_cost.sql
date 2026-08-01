-- ADR 020 Phase 3: cost ledger surfaced in the same admin users list rather
-- than a separate RPC -- this function already aggregates per-user activity
-- (analyses_count, last_session), and total_cost_usd/total_tokens_used are
-- just two more aggregates from the same usage_logs ledger (ADR 020 Phase 3
-- populates tokens_used/cost_usd on every 'analysis_completed' row).
drop function if exists public.admin_list_users_activity();

create function public.admin_list_users_activity()
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
  -- NOTE: usage_logs has an established 30-day purge policy (pg_cron job
  -- 'purge-usage-logs-daily', add_health_ledger_and_log_purging.sql), shared
  -- with the existing Usage tab's getUsageEventCounts. total_cost_usd/
  -- total_tokens_used are therefore a ROLLING 30-day total, not a lifetime
  -- ledger -- surfaced honestly as "Cost (30d)" in the admin UI rather than
  -- fighting the established retention policy (cubic review, PR #175).
  left join lateral (
    select sum(cost_usd) as total_cost_usd, sum(tokens_used) as total_tokens_used
    from public.usage_logs
    where usage_logs.user_id = u.id and usage_logs.action = 'analysis_completed'
  ) c on true
  order by u.created_at desc;
end;
$$;
