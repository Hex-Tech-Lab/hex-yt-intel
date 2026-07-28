-- upstash_snapshots: periodic /info poll history for Upstash Redis + Vector.
--
-- Motivation: the existing admin log routes (upstash-redis, upstash-vector)
-- only ever return a live point-in-time snapshot -- no trend, nothing
-- persisted. Production-incident troubleshooting needs to look back in time
-- ("was Redis already degraded 20 minutes ago?"), so a QStash-scheduled poll
-- writes one row per check here and the log routes can surface recent
-- history alongside the live fetch.
--
-- jsonb stats blob (not one column per metric): the two providers' /info
-- responses have different, provider-specific shapes (Redis returns raw
-- INFO-protocol text lines; Vector returns a JSON object of index stats),
-- and the field set has already drifted across Upstash API versions in this
-- repo's history -- a fixed column schema would need a migration every time
-- a field is added/renamed. jsonb is simpler and future-proof; the admin-only
-- UI reads it directly.
create table if not exists public.upstash_snapshots (
  id          bigint generated always as identity primary key,
  provider    text         not null check (provider in ('redis', 'vector')),
  polled_at   timestamptz  not null default now(),
  stats       jsonb        not null,
  ok          boolean      not null default true,
  error       text
);

comment on table public.upstash_snapshots is
  'One row per QStash-scheduled poll of Upstash Redis/Vector /info endpoints. Operational telemetry history, not user data -- RLS-locked with no permissive policy (service_role only), same pattern as public.app_settings.';

create index if not exists upstash_snapshots_provider_polled_at_idx
  on public.upstash_snapshots (provider, polled_at desc);

-- RLS enabled with NO permissive policy = the table is locked to service_role
-- only. Reads happen server-side via the admin log routes (service client),
-- same as app_settings -- never queried directly from the browser.
alter table public.upstash_snapshots enable row level security;

-- Retention: keep this cheap and unbounded-append-safe. At a 15-min poll
-- interval, 1 row * 2 providers ~= 96 rows/day ~= ~35k rows/year -- trivial
-- storage, so no automatic pruning is added here. If retention becomes a
-- concern later, add a companion purge job mirroring transcript-purger.
