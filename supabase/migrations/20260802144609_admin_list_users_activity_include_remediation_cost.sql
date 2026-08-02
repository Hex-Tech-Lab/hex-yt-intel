-- Cubic review, PR #178: dimension-remediation spend (usage_logs action
-- 'dimension_remediation', added by 20260802122006 on this same PR) is
-- excluded from admin_list_users_activity's total_cost_usd/
-- total_tokens_used -- the cost aggregation only ever filtered
-- action = 'analysis_completed'. A user whose only usage_logs rows are
-- remediation spend (attributed to gap.userId, the real analysis owner)
-- would show $0 in admin totals despite genuinely costing money.
--
-- Using `create or replace` (not the drop+create the prior migration used)
-- specifically because drop+create resets EXECUTE grants to PUBLIC by
-- default, which already bit this exact function once
-- (20260801084347_admin_list_users_activity_restore_grants.sql) -- create
-- or replace preserves existing grants since the signature/return type are
-- unchanged.
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
  -- usage_logs has an established 30-day purge policy (pg_cron job
  -- 'purge-usage-logs-daily'), so this is a ROLLING 30-day total, not a
  -- lifetime ledger -- surfaced honestly as "Cost (30d)" in the admin UI
  -- (cubic review, PR #175). Now includes 'dimension_remediation' spend
  -- alongside 'analysis_completed' so remediation-only users aren't
  -- misreported as $0 (cubic review, PR #178).
  left join lateral (
    select sum(cost_usd) as total_cost_usd, sum(tokens_used) as total_tokens_used
    from public.usage_logs
    where usage_logs.user_id = u.id
      and usage_logs.action in ('analysis_completed', 'dimension_remediation')
  ) c on true
  order by u.created_at desc;
end;
$$;
