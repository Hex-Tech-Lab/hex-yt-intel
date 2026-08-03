-- Migration: Add per-category LLM cost and turn columns to admin_list_users_activity
-- Categories:
-- 1. Analysis (action='analysis_completed' or 'analysis')
-- 2. Chat (action='chat_turn')
-- 3. Remediation (action='dimension_remediation')

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
