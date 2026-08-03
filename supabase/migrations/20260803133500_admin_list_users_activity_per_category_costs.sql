-- Migration: Add per-category LLM cost and turn columns to admin_list_users_activity
-- Categories:
-- 1. Analysis (action='analysis_completed' or 'analysis')
-- 2. Chat (action='chat_turn')
-- 3. Remediation (action='dimension_remediation')
--
-- NOTE: adding columns to a RETURNS TABLE(...) signature is a return-type
-- change, which CREATE OR REPLACE FUNCTION cannot perform (Postgres errors
-- "cannot change return type of existing function") -- DROP FUNCTION is
-- required first. That DROP silently resets EXECUTE back to PUBLIC/anon
-- default grants, which is exactly what happened in
-- 20260801084347_admin_list_users_activity_restore_grants.sql after
-- 20260801081647's DROP+CREATE -- so the REVOKE/GRANT pair below is
-- mandatory, not optional, every time this function's signature changes.
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
  total_tokens_used bigint,
  analysis_turns bigint,
  analysis_cost_usd numeric,
  chat_turns bigint,
  chat_cost_usd numeric,
  remediation_turns bigint,
  remediation_cost_usd numeric
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
    coalesce(c.total_tokens_used, 0) as total_tokens_used,
    coalesce(c.analysis_turns, 0) as analysis_turns,
    coalesce(c.analysis_cost_usd, 0) as analysis_cost_usd,
    coalesce(c.chat_turns, 0) as chat_turns,
    coalesce(c.chat_cost_usd, 0) as chat_cost_usd,
    coalesce(c.remediation_turns, 0) as remediation_turns,
    coalesce(c.remediation_cost_usd, 0) as remediation_cost_usd
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
    select
      coalesce(sum(cost_usd), 0) as total_cost_usd,
      coalesce(sum(tokens_used), 0) as total_tokens_used,
      count(*) filter (where usage_logs.action in ('analysis_completed', 'analysis')) as analysis_turns,
      coalesce(sum(cost_usd) filter (where usage_logs.action in ('analysis_completed', 'analysis')), 0) as analysis_cost_usd,
      count(*) filter (where usage_logs.action = 'chat_turn') as chat_turns,
      coalesce(sum(cost_usd) filter (where usage_logs.action = 'chat_turn'), 0) as chat_cost_usd,
      count(*) filter (where usage_logs.action = 'dimension_remediation') as remediation_turns,
      coalesce(sum(cost_usd) filter (where usage_logs.action = 'dimension_remediation'), 0) as remediation_cost_usd
    from public.usage_logs
    where usage_logs.user_id = u.id
      and usage_logs.action in ('analysis_completed', 'analysis', 'chat_turn', 'dimension_remediation')
  ) c on true
  order by u.created_at desc;
end;
$$;

revoke all on function public.admin_list_users_activity() from public, anon;
grant execute on function public.admin_list_users_activity() to authenticated;

-- supabase-postgres-best-practices flag: the lateral above filters on 4
-- action values via 4x FILTER, but idx_usage_logs_user_analysis_completed
-- (20260801085822) only covers 'analysis_completed' -- the other 3 fell
-- back to a per-user scan of idx_usage_logs_user_id filtered in-memory.
-- This composite index subsumes it (covers all 4 actions actually used by
-- this query, leading column supports the per-action FILTER scans too).
drop index if exists public.idx_usage_logs_user_analysis_completed;

create index if not exists idx_usage_logs_user_activity_costs
  on public.usage_logs (user_id, action)
  where action in ('analysis_completed', 'analysis', 'chat_turn', 'dimension_remediation');
