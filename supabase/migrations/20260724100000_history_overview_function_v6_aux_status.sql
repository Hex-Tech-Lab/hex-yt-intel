-- History overview v6 — add aux-element status booleans (digest, description,
-- channel meta, comments) to the winning row, so the history list can render
-- the same DIGEST/DESCRIPTION/CHANNEL META/COMMENTS chip row already shipped
-- in the console screen (Wave A4) without an extra per-row fetch.
--
-- Sourced from the winning analysis's own columns/JSON, same fields
-- useAuxElementStatus.ts already reads client-side for the console screen:
--   - has_digest: executive_digest is non-null
--   - has_description: validation_report.metadata.description non-empty
--   - has_channel_meta: validation_report.channelMeta non-empty object
--   - has_comments: validation_report.comments non-empty array
--
-- `create or replace` cannot change a function's return-row shape (adding 4
-- new OUT columns here) -- Postgres requires the old signature dropped first
-- (SQLSTATE 42P13, caught by CI's `supabase db push` before it ever reached
-- the remote database).

drop function if exists public.get_user_history_overview(uuid);

create function public.get_user_history_overview(p_user_id uuid)
returns table (
  base_video_id text,
  latest_analysis_id uuid,
  title text,
  channel_title text,
  first_analyzed_at timestamptz,
  last_analyzed_at timestamptz,
  times_analyzed bigint,
  views bigint,
  best_dimensions int,
  present_dimensions int[],
  status text,
  has_digest boolean,
  has_description boolean,
  has_channel_meta boolean,
  has_comments boolean
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
      coalesce(viewed_count, 0) as viewed_count,
      billing_status,
      validation_passed,
      executive_digest,
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
      count(*) as times_analyzed,
      sum(viewed_count) as views,
      max(dim_count) as best_dimensions
    from scored
    group by base_video_id
  ),
  winner as (
    select * from (
      select s.*, row_number() over (
        partition by s.base_video_id
        order by s.dim_count desc, s.created_at desc
      ) as rn
      from scored s
    ) r where r.rn = 1
  ),
  newest as (
    select * from (
      select s.base_video_id, s.billing_status, s.created_at, row_number() over (
        partition by s.base_video_id
        order by s.created_at desc
      ) as rn
      from scored s
    ) r where r.rn = 1
  )
  select
    a.base_video_id,
    w.id as latest_analysis_id,
    coalesce(w.title, 'Untitled Analysis') as title,
    w.channel_title,
    (a.first_analyzed_at at time zone 'UTC') as first_analyzed_at,
    (a.last_analyzed_at at time zone 'UTC') as last_analyzed_at,
    a.times_analyzed,
    a.views,
    a.best_dimensions,
    w.present_dims as present_dimensions,
    case
      when n.billing_status = 'processing'
        and (n.created_at at time zone 'UTC') > (now() - interval '15 minutes') then 'processing'
      when w.billing_status = 'completed' then 'complete'
      when cardinality(w.present_dims) >= 8 then 'partial'
      else 'failed'
    end as status,
    (w.executive_digest is not null) as has_digest,
    (coalesce(length(trim(both from (w.validation_report -> 'metadata' ->> 'description'))), 0) > 0) as has_description,
    (jsonb_typeof(w.validation_report -> 'channelMeta') = 'object'
      and w.validation_report -> 'channelMeta' <> '{}'::jsonb) as has_channel_meta,
    (jsonb_typeof(w.validation_report -> 'comments') = 'array'
      and jsonb_array_length(w.validation_report -> 'comments') > 0) as has_comments
  from agg a
  join winner w on w.base_video_id = a.base_video_id
  join newest n on n.base_video_id = a.base_video_id
  order by a.last_analyzed_at desc;
$$;
