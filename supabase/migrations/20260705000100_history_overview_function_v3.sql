-- History overview v3 — count dimensions across BOTH persisted formats.
--
-- Analyses are persisted in analysis_markdown in one of two shapes:
--   A) a ```json-fenced UCISPayload whose `dimensions` array carries one object
--      per dimension (each with a numeric `number`), OR
--   B) stitched "### DIMENSION N" markdown headers.
-- v1/v2 only counted format B, so completed format-A analyses reported 0 dims
-- and were mislabeled failed. This adds a format-aware extractor and uses it.
--
-- Mirrors the TS single-source-of-truth web/lib/utils/count-ucis-dimensions.ts
-- (parseUcisDimensionNumbers) used by the reaper. (Long-term these collapse into
-- one persisted dimension_count written by the app; tracked separately.)
--
-- Also bounds the 'processing' status override to a 15-minute window so a
-- crashed/abandoned re-run can't mask a completed analysis as processing forever
-- (matches the quota function's staleness assumption).

create or replace function public.ucis_present_dimensions(md text)
returns int[]
language plpgsql
immutable
set search_path = public
as $$
declare
  cleaned text;
  j jsonb;
  nums int[];
begin
  if md is null or btrim(md) = '' then
    return '{}'::int[];
  end if;

  cleaned := btrim(md);
  -- Strip a leading ```lang fence and its trailing ``` if present.
  if left(cleaned, 3) = '```' then
    cleaned := regexp_replace(cleaned, '^```[a-zA-Z0-9]*[ \t]*\r?\n', '');
    cleaned := regexp_replace(cleaned, '\r?\n?```[ \t\r\n]*$', '');
    cleaned := btrim(cleaned);
  end if;

  -- Format A: JSON payload with a `dimensions` array of objects carrying `number`.
  if left(cleaned, 1) = '{' then
    begin
      j := cleaned::jsonb;
      if jsonb_typeof(j->'dimensions') = 'array' then
        select array_agg(distinct n order by n) into nums
        from (
          select (elem->>'number')::int as n
          from jsonb_array_elements(j->'dimensions') elem
          where (elem->>'number') ~ '^\d+$'
        ) s
        where n between 1 and 11;
        return coalesce(nums, '{}'::int[]);
      end if;
    exception when others then
      -- Not valid JSON (e.g. a truncated stuck row) — fall through to markdown.
      null;
    end;
  end if;

  -- Format B: stitched "### DIMENSION N" headers (line-anchored, case-insensitive).
  select array_agg(distinct (m[1])::int order by (m[1])::int) into nums
  from regexp_matches(md, '^###\s+DIMENSION\s+(\d+)', 'gni') m
  where (m[1])::int between 1 and 11;
  return coalesce(nums, '{}'::int[]);
end;
$$;

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
      when w.billing_status = 'completed' and w.validation_passed then 'complete'
      when cardinality(w.present_dims) >= 8 then 'partial'
      else 'failed'
    end as status
  from agg a
  join winner w on w.base_video_id = a.base_video_id
  join newest n on n.base_video_id = a.base_video_id
  order by a.last_analyzed_at desc;
$$;
