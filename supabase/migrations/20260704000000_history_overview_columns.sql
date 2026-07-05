-- History overview support (PR-B: video-centric history table).
--
-- Two additive columns on `analyses`:
--   * viewed_count    — incremented on every open of a saved analysis (product
--                       decision: count every open), surfaced as "Views".
--   * dimension_count — cached count of generated UCIS dimensions so the history
--                       table can show honest completeness (n/11) and status
--                       without re-parsing analysis_markdown on every read.
--
-- Both are safe/additive; existing rows keep working.

alter table public.analyses
  add column if not exists viewed_count integer not null default 0,
  add column if not exists dimension_count integer;

-- Backfill dimension_count from existing markdown by counting DISTINCT UCIS
-- dimension headers ("### DIMENSION N", N in 1..11) — mirrors the app parser
-- (parseUcisDimensions) which keys dimensions by number. The authoritative count
-- is (re)written on the next persist; this backfill is for immediate history
-- display of already-stored analyses.
update public.analyses a
set dimension_count = coalesce((
  select count(distinct (m[1])::int)
  from regexp_matches(coalesce(a.analysis_markdown, ''), '###\s+DIMENSION\s+(\d+)', 'gi') as m
  where (m[1])::int between 1 and 11
), 0)
where a.dimension_count is null;
