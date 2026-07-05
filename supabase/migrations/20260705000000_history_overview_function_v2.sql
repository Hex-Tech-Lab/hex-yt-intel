-- History overview function v2 — correctness hardening (PR-B review follow-up).
--
-- The v1 function trusted two columns the application never maintains:
--   * dimension_count — no writer exists (persist paths never set it), so for
--     any video analyzed AFTER the columns migration it stays NULL/0. That made
--     best_dimensions=0 and status='failed' for freshly-completed analyses.
--   * the extraction regex was unanchored ('###\s+DIMENSION\s+(\d+)'), so an
--     inline cross-reference ("see ### DIMENSION 10") inflated present_dimensions
--     and contradicted best_dimensions.
--
-- Fix: derive per-row dimension coverage LIVE from analysis_markdown using the
-- same line-anchored, case-insensitive pattern as the canonical app parser
-- (parseUcisDimensions: /^###\s+DIMENSION\s+(\d+)\b/gim). Winner selection,
-- best_dimensions, present_dimensions and status all flow from this live count,
-- so the overview is correct regardless of the dimension_count column. Also:
--   * cast the naive `created_at` (timestamp, stored as UTC) to timestamptz via
--     AT TIME ZONE 'UTC' so returned instants don't shift with session TimeZone.
--   * surface an in-flight re-analysis honestly: if the newest attempt for a
--     video is still 'processing', report status='processing' even when an older
--     completed attempt is the winner (which remains the open/restore target).
--
-- Per-user history is small, so parsing each row's markdown here is acceptable;
-- the dimension_count column is left in place (harmless) for a future writer.

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
  best_dimensions integer,
  present_dimensions integer[],
  status text
)
language sql
stable
security invoker
set search_path = public
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
      -- Live per-row present dimensions parsed from markdown, line-anchored
      -- (flag 'n') and case-insensitive (flag 'i') to mirror parseUcisDimensions.
      coalesce((
        select array_agg(distinct (m[1])::int order by (m[1])::int)
        from regexp_matches(coalesce(analysis_markdown, ''), '^###\s+DIMENSION\s+(\d+)', 'gni') as m
        where (m[1])::int between 1 and 11
      ), '{}'::int[]) as present_dims
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
      select s.base_video_id, s.billing_status, row_number() over (
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
      when n.billing_status = 'processing' then 'processing'
      when w.billing_status = 'completed' and w.validation_passed then 'complete'
      when cardinality(w.present_dims) >= 8 then 'partial'
      else 'failed'
    end as status
  from agg a
  join winner w on w.base_video_id = a.base_video_id
  join newest n on n.base_video_id = a.base_video_id
  order by a.last_analyzed_at desc;
$$;
