-- History overview v4 — fix dead 'complete' condition.
--
-- v3's status CASE checked `billing_status = 'completed'`, but 'completed' is
-- not a valid billing_status value anywhere in the app (the type is
-- 'pending' | 'chargeable' | 'charged' | 'failed' — see
-- web/lib/types/validation-report.ts). That branch could never match, so every
-- analysis — including fully complete 11/11-dimension ones — fell through to
-- the `cardinality(present_dims) >= 8 then 'partial'` branch. This is the root
-- cause of "11/11 dims" analyses being labeled Partial/Incomplete in history.
--
-- Fix: match the same billing_status values the rest of the app treats as
-- complete (chargeable = ready to charge, charged = payment processed) instead
-- of the nonexistent 'completed' value. Drops the `validation_passed` AND
-- clause too — it's redundant once billing_status is checked correctly, and
-- keeping it risked the same silent-false-forever failure mode if that column
-- disagrees with billing_status for any legacy row.

create or replace function public.get_user_history_overview(p_user_id uuid)
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
  status text
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
      when w.billing_status in ('chargeable', 'charged') then 'complete'
      when cardinality(w.present_dims) >= 8 then 'partial'
      else 'failed'
    end as status
  from agg a
  join winner w on w.base_video_id = a.base_video_id
  join newest n on n.base_video_id = a.base_video_id
  order by a.last_analyzed_at desc;
$$;
