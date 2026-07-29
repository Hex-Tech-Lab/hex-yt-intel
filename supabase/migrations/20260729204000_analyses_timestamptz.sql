-- RCA 2026-07-29: analyses.created_at/updated_at/published_at were
-- `timestamp without time zone`. Session timezone confirmed UTC (SHOW
-- timezone), and all three columns are always written with UTC values
-- (now()/server time for created_at/updated_at, YouTube API's UTC-ISO
-- publishedAt for published_at) -- so reinterpreting existing values as UTC
-- when converting to timestamptz is value-preserving, not a shift.
--
-- This was the root cause of two separate observed bugs: (1) the admin Logs
-- UI's dual-timezone display was wrong because PostgREST serializes a naive
-- timestamp with no Z/offset, and the browser's `new Date()` parsed it as
-- local time instead of UTC; (2) time-range filtering could leak rows
-- outside the requested window, since comparing a tz-aware filter value
-- against a tz-naive column depends on implicit cast/session-timezone
-- behavior rather than a true UTC-to-UTC comparison.
--
-- Applied directly to production on 2026-07-29 via raw SQL (apply_migration
-- hit "memory required is 61 MB, maintenance_work_mem is 32 MB" running all
-- three ALTERs together; ran individually instead with a session-scoped
-- maintenance_work_mem bump). This file exists so the change is tracked in
-- version control and safely re-appliable to any OTHER environment
-- (staging/preview) that hasn't had the manual fix -- guarded so it's a
-- no-op if the columns are already timestamptz (production, after today).
do $$
begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'analyses' and column_name = 'created_at') = 'timestamp without time zone' then
    execute 'alter table public.analyses alter column created_at type timestamptz using created_at at time zone ''UTC''';
  end if;

  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'analyses' and column_name = 'updated_at') = 'timestamp without time zone' then
    execute 'alter table public.analyses alter column updated_at type timestamptz using updated_at at time zone ''UTC''';
  end if;

  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'analyses' and column_name = 'published_at') = 'timestamp without time zone' then
    execute 'alter table public.analyses alter column published_at type timestamptz using published_at at time zone ''UTC''';
  end if;
end $$;
