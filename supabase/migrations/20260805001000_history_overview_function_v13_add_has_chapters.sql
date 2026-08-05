-- History overview v13. Adds the `has_chapters` column for the chapters
-- feature (docs/agent-prompts/2026-08-05-oc-chapters-wiring-CORRECTED.md,
-- Gap 4). v12's TS-side mapping (web/lib/utils/history-overview.ts:
-- `hasChapters: row.has_chapters ?? null`) already referenced this column,
-- but the RPC never sent it, so every row evaluated to null and the
-- chapters chip rendered grey unconditionally.
--
-- Chapters live in public.transcript_chapters (72h TTL, same lifecycle as
-- transcripts), not in the analysis payload, so this uses a correlated
-- EXISTS subquery against that table rather than the has_digest-style
-- payload checks.
--
-- THREE-STATE semantics (per the AGY chip spec and the wiring prompt's
-- Gap 2 decision): a real chapter row (idx >= 0) -> green (true); a
-- sentinel "attempted but found zero" row (idx = -1, set when the worker
-- parsed the description and found no markers) -> orange (false); no rows
-- at all (video predates the feature / never attempted) -> grey (null).
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
    (case
      when exists (
        select 1 from public.transcript_chapters tc
        where tc.video_id = a.base_video_id and tc.idx >= 0
      ) then true
      when exists (
        select 1 from public.transcript_chapters tc
        where tc.video_id = a.base_video_id and tc.idx = -1
      ) then false
      else null
    end) as has_chapters,
    l.client_platform as client_platform
  from agg a
  join latest l on l.base_video_id = a.base_video_id
  order by a.last_analyzed_at desc;
$$;

revoke execute on function public.get_user_history_overview(uuid) from anon, authenticated, public;