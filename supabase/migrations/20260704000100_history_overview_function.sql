-- History overview aggregation (PR-B: video-centric history table).
--
-- Collapses every analysis a user has run for the same underlying video into a
-- single "overview" row. Re-analyzing a video archives the prior row by suffixing
-- its video_id with `_archived_<timestamp>` (see SupabaseAnalysisAdapter), so the
-- canonical video identity is the base id with that suffix stripped.
--
-- Per base video the function returns:
--   * the WINNER row (most complete analysis: highest dimension_count, newest on
--     ties) — its id drives "open/restore", its markdown drives which specific
--     UCIS dimensions are present (so the UI can offer "re-analyze the missing N").
--   * aggregate stats across all attempts: first/last analyzed, times analyzed,
--     summed views, best dimension count, and an honest rollup status.
--
-- Tenant isolation: callers pass the authenticated user id; the WHERE clause is
-- the isolation boundary (the server invokes this with the service client, same
-- pattern as the other adapter reads). `security invoker` keeps table RLS in
-- force for any non-service caller.

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
      analysis_markdown,
      billing_status,
      validation_passed,
      coalesce(dimension_count, 0) as dim_count
    from public.analyses
    where user_id = p_user_id
  ),
  agg as (
    select
      base_video_id,
      min(created_at) as first_analyzed_at,
      max(created_at) as last_analyzed_at,
      count(*) as times_analyzed,
      sum(viewed_count) as views,
      max(dim_count) as best_dimensions
    from base
    group by base_video_id
  ),
  ranked as (
    select
      b.*,
      row_number() over (
        partition by b.base_video_id
        order by b.dim_count desc, b.created_at desc
      ) as rn
    from base b
  ),
  winner as (
    select * from ranked where rn = 1
  )
  select
    a.base_video_id,
    w.id as latest_analysis_id,
    coalesce(w.title, 'Untitled Analysis') as title,
    w.channel_title,
    a.first_analyzed_at,
    a.last_analyzed_at,
    a.times_analyzed,
    a.views,
    a.best_dimensions,
    coalesce((
      select array_agg(distinct (m[1])::int order by (m[1])::int)
      from regexp_matches(coalesce(w.analysis_markdown, ''), '###\s+DIMENSION\s+(\d+)', 'gi') as m
      where (m[1])::int between 1 and 11
    ), '{}'::int[]) as present_dimensions,
    case
      when w.billing_status = 'completed' and w.validation_passed then 'complete'
      when w.billing_status = 'processing' then 'processing'
      -- 8 mirrors MIN_USABLE_DIMENSIONS (web/lib/config/synthesis.ts): at/above
      -- this a stuck/unvalidated row is still usable ("partial"), below it "failed".
      when a.best_dimensions >= 8 then 'partial'
      else 'failed'
    end as status
  from agg a
  join winner w on w.base_video_id = a.base_video_id
  order by a.last_analyzed_at desc;
$$;
