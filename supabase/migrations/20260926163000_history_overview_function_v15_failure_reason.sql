-- History overview v15. Surfaces the stored failure reason on history cards
-- (user report 2026-09-26: a failed attempt — worker streaming crash, analysis
-- ca5d699f / video EOiypb2wXM0 — did appear nowhere with an explanation; the
-- user must be able to see WHY an attempt failed and that it was never
-- analyzed, so they remember to retry). The data was already persisted by the
-- reaper/settlement path in analyses.validation_report.reason — this only
-- exposes it through the overview RPC and leaves every existing column and
-- status branch untouched.
drop function if exists public.get_user_history_overview(uuid);

create function public.get_user_history_overview(p_user_id uuid)
returns table (
  base_video_id text,
  latest_analysis_id uuid,
  title text,
  channel_title text,
  first_analyzed_at timestamptz,
  last_analyzed_at timestamptz,
  last_viewed_at timestamptz,
  times_analyzed bigint,
  views bigint,
  best_dimensions int,
  present_dimensions int[],
  status text,
  has_digest boolean,
  has_description boolean,
  has_channel_meta boolean,
  has_comments boolean,
  has_chapters boolean,
  client_platform text,
  failure_reason text
)
language sql
stable
as $$
  with base as (
    select
      regexp_replace(video_id, '_archived_.*$', '') as base_video_id,
      id,
      title,
      channel_title,
      created_at,
      last_viewed_at,
      coalesce(viewed_count, 0) as viewed_count,
      billing_status,
      validation_passed,
      executive_digest,
      client_platform,
      validation_report,
      public.ucis_present_dimensions(analysis_markdown) as present_dims
    from public.analyses
    where user_id = p_user_id
  ),
  scored as (
    select b.*, cardinality(b.present_dims) as dim_count
    from base b
  ),
  agg as (
    select
      base_video_id,
      min(created_at) as first_analyzed_at,
      max(created_at) as last_analyzed_at,
      max(last_viewed_at) as last_viewed_at,
      count(*) as times_analyzed,
      sum(viewed_count) as views,
      max(dim_count) as best_dimensions
    from scored
    group by base_video_id
  ),
  latest as (
    select r.*, an.analysis_payload
    from (
      select s.*, row_number() over (
        partition by s.base_video_id
        order by s.created_at desc, s.id desc
      ) as rn
      from scored s
    ) r
    join public.analyses an on an.id = r.id
    where r.rn = 1
  )
  select
    a.base_video_id,
    l.id as latest_analysis_id,
    coalesce(l.title, 'Untitled Analysis') as title,
    l.channel_title,
    (a.first_analyzed_at at time zone 'UTC') as first_analyzed_at,
    (a.last_analyzed_at at time zone 'UTC') as last_analyzed_at,
    (a.last_viewed_at at time zone 'UTC') as last_viewed_at,
    a.times_analyzed,
    a.views,
    a.best_dimensions,
    l.present_dims as present_dimensions,
    case
      when l.billing_status = 'processing'
        and l.created_at > (now() - interval '15 minutes') then 'processing'
      when l.billing_status = 'processing' then 'stalled'
      when l.billing_status = 'completed' then 'complete'
      when cardinality(l.present_dims) >= 8 then 'partial'
      else 'failed'
    end as status,
    (l.executive_digest is not null) as has_digest,
    (coalesce(length(trim(both from (l.analysis_payload -> 'videoMetadata' ->> 'description'))), 0) > 0) as has_description,
    (jsonb_typeof(l.analysis_payload -> 'channelMeta') = 'object'
      and l.analysis_payload -> 'channelMeta' <> '{}'::jsonb) as has_channel_meta,
    (case
      when jsonb_typeof(l.analysis_payload -> 'comments') = 'array'
        then jsonb_array_length(l.analysis_payload -> 'comments') > 0
      else false
    end) as has_comments,
    (case
      when exists (
        select 1 from public.transcript_chapters tc
        where tc.video_id = a.base_video_id and tc.idx >= 0 and tc.expires_at > now()
      ) then true
      when exists (
        select 1 from public.transcript_chapters tc
        where tc.video_id = a.base_video_id and tc.idx = -1 and tc.expires_at > now()
      ) then false
      else null
    end) as has_chapters,
    l.client_platform as client_platform,
    -- Failure explanation for terminal-failure cards (null for non-failures).
    (case
      when l.billing_status = 'processing' then null
      when l.billing_status = 'completed' then null
      when cardinality(l.present_dims) >= 8 then null
      else nullif(trim(both from (l.validation_report ->> 'reason')), '')
    end) as failure_reason
  from agg a
  join latest l on l.base_video_id = a.base_video_id
  order by a.last_analyzed_at desc;
$$;

-- DROP+CREATE resets EXECUTE grants; the only caller is the server-side
-- service-role client (SupabaseAnalysisAdapter.getUserHistoryOverview ->
-- getSupabaseServiceClient().rpc(...), never the browser), so grant
-- least-privilege EXECUTE explicitly rather than relying on default
-- privileges (same class as the 20260820100539 admin-RPC revoke precedent).
revoke execute on function public.get_user_history_overview(uuid) from anon, authenticated, public;
grant execute on function public.get_user_history_overview(uuid) to service_role;
