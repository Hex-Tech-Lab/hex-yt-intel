-- History overview v12. Two real findings from PR review on v11
-- (2026-08-02), both fixed here:
--
-- 1. Latest-row selection ordered by `s.created_at desc` alone with no
--    tiebreaker. Two attempts for the same video landing at the identical
--    microsecond is astronomically unlikely via this app's real UI flow,
--    but the fix is free and removes the theoretical nondeterminism:
--    `s.id desc` as a secondary key.
-- 2. The 'processing' status branch compared `(l.created_at at time zone
--    'UTC')` -- which converts a timestamptz to a plain timestamp
--    representing UTC wall-clock -- against `now()`, a timestamptz. Postgres
--    resolves a timestamp-vs-timestamptz comparison by implicitly casting
--    the timestamptz side to the SESSION's timezone, not UTC. That silently
--    compares "created_at's UTC wall-clock" against "now()'s session-
--    timezone wall-clock" -- correct only when session timezone happens to
--    be UTC, wrong (skewed by the session's UTC offset) otherwise. Fix:
--    drop the AT TIME ZONE conversion for this comparison entirely --
--    comparing two timestamptz values directly is instant-based and
--    correct regardless of session timezone. AT TIME ZONE conversions
--    elsewhere in this function (first_analyzed_at/last_analyzed_at/
--    last_viewed_at output columns) are untouched -- those are for display
--    formatting, not comparison, and are fine as-is.
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
  client_platform text
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
    l.client_platform as client_platform
  from agg a
  join latest l on l.base_video_id = a.base_video_id
  order by a.last_analyzed_at desc;
$$;

revoke execute on function public.get_user_history_overview(uuid) from anon, authenticated, public;
