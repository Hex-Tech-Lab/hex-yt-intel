-- Device/platform tag for the history list (RCA 2026-07-24: the user's own
-- SOTU analysis silently landed under a different Supabase Auth account
-- purely because that device happened to be signed into a different email.
-- The data was re-pointed at the DB layer already; this column gives the UI
-- an actual answer to "which device did I use for this?" so the next mix-up
-- is visible instead of silent. Cosmetic only -- never read for auth/billing.
--
-- Nullable, no backfill: older rows simply render with no chip / an
-- "unknown" chip client-side. `ios-app` / `android-app` are accepted by the
-- CHECK constraint now (native mobile apps "when we have them" per the
-- user) even though nothing can produce them yet, so shipping those clients
-- later needs no further migration.
--
-- History overview v7 -- add client_platform of the WINNER row so the
-- history list can render the chip without an extra per-row fetch, same
-- pattern as v6's aux-status booleans. `create or replace` cannot change a
-- function's return-row shape -- Postgres requires the old signature
-- dropped first (SQLSTATE 42P13, this bit a sibling migration earlier this
-- same day per v6's own header).

alter table public.analyses
  add column if not exists client_platform text
    constraint analyses_client_platform_check
    check (client_platform is null or client_platform in (
      'ios', 'ios-app', 'android', 'android-app', 'macos', 'windows', 'linux', 'web'
    ));

comment on column public.analyses.client_platform is
  'UA-derived device the analysis run was created from (cosmetic display only, never used for auth/billing decisions). ios-app/android-app reserved for future native mobile clients.';

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
      coalesce(viewed_count, 0) as viewed_count,
      billing_status,
      validation_passed,
      executive_digest,
      validation_report,
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
      and jsonb_array_length(w.validation_report -> 'comments') > 0) as has_comments,
    w.client_platform as client_platform
  from agg a
  join winner w on w.base_video_id = a.base_video_id
  join newest n on n.base_video_id = a.base_video_id
  order by a.last_analyzed_at desc;
$$;
