-- History overview v11 -- stop conflating "most complete analysis ever run"
-- with "the last analysis run" for a video.
--
-- Root cause of live bug report 2026-08-02: v10 (and every version back to
-- v4) picked the row keyed off `latest_analysis_id`/`w` (the WINNER: highest
-- dim_count, newest as tiebreaker only) to source title/status/has_digest/
-- present_dimensions/client_platform, while `last_analyzed_at` was always
-- the true most-recent attempt's timestamp (from `agg`, an aggregate over
-- ALL attempts). When a user re-ran a video and the newest attempt failed or
-- landed without its digest (ADR 010: dimension-0 digest is a separate
-- idempotent step that can lag or fail independently of the main 11
-- dimensions), the card showed the NEWER timestamp next to the OLDER run's
-- content: status "complete" with an empty Digest chip, no signal that the
-- data on screen wasn't from "the last analyze" the timestamp implied.
-- Confirmed live: base_video_id LTNVA2iP9YU had a 2026-08-02 FAILED,
-- digest-less attempt and a 2026-07-31 completed archived attempt; v10
-- returned latest_analysis_id = the 2026-07-31 row with last_analyzed_at =
-- 2026-08-02 -- exactly the "says complete, digest sometimes empty, doesn't
-- match what's below" report.
--
-- Fix: the row that titles/statuses/digest-flags/dimension-dots the card,
-- and that `analysisId` points restore-on-click at, is now the NEWEST
-- attempt (ties impossible -- created_at is the sole order key), full stop.
-- `best_dimensions` remains the all-time aggregate max across every attempt
-- (already sourced from `agg`, unchanged) -- that's an honest "best ever
-- achieved" stat, not something masquerading as "current".

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
  -- The single most recent attempt per video -- this, not the best-ever
  -- attempt, is what the card's timestamp/status/digest/dimension-dots and
  -- click-to-restore target must all agree on.
  latest as (
    select r.*, an.analysis_payload
    from (
      select s.*, row_number() over (
        partition by s.base_video_id
        order by s.created_at desc
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
        and (l.created_at at time zone 'UTC') > (now() - interval '15 minutes') then 'processing'
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

-- v10's function object was dropped and recreated above, which resets grants
-- to Postgres defaults (EXECUTE to PUBLIC) -- re-apply the same per-function
-- revoke the 20260802130715 migration put in place, or this reopens the IDOR
-- it closed (arbitrary p_user_id via PostgREST).
revoke execute on function public.get_user_history_overview(uuid) from anon, authenticated, public;
