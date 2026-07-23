-- History overview v5 — revert v4's 'chargeable'/'charged' check; those
-- values have NEVER been valid.
--
-- RCA (2026-07-23): v4's own comment claimed "'completed' is not a valid
-- billing_status value anywhere in the app" and changed the check to
-- `billing_status in ('chargeable', 'charged')`. That claim was wrong: the
-- `analyses.billing_status` column has enforced
-- `CHECK (billing_status IN ('processing', 'completed', 'failed'))` since
-- migration 20260611183500 -- 'chargeable' and 'charged' have NEVER been
-- valid values for this column, and every write attempt of 'chargeable' has
-- always violated that constraint. v4 took v3's actually-correct check
-- (`billing_status = 'completed'`) and "fixed" it into a condition that can
-- never match a real row -- a live production test (2026-07-23) confirmed no
-- analysis has successfully reached ANY terminal billing_status since
-- 2026-07-13, ten days of every genuinely-complete analysis silently falling
-- through to the `>= 8 dims -> 'partial'` branch. See
-- web/lib/types/validation-report.ts's BillingStatus type for the full RCA
-- and the accompanying application-layer fixes (this migration is the DB-side
-- half of that same fix).
--
-- Fix: revert to the correct v3 check, `billing_status = 'completed'`.

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
      when w.billing_status = 'completed' then 'complete'
      when cardinality(w.present_dims) >= 8 then 'partial'
      else 'failed'
    end as status
  from agg a
  join winner w on w.base_video_id = a.base_video_id
  join newest n on n.base_video_id = a.base_video_id
  order by a.last_analyzed_at desc;
$$;
