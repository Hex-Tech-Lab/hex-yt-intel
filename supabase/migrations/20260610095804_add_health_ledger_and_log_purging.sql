-- 1. Create health_ledger table for daily Sentry incident/health snapshots
create table if not exists public.health_ledger (
  id uuid primary key default gen_random_uuid(),
  subsystem_id text not null,
  subsystem_name text not null,
  status text not null,
  uptime numeric(5,2) not null,
  incident_count integer not null default 0,
  recorded_at timestamptz not null default now()
);

-- Enable RLS
alter table public.health_ledger enable row level security;

-- Public Read Policy
drop policy if exists "health_ledger_select_public" on public.health_ledger;
create policy "health_ledger_select_public"
  on public.health_ledger for select
  to public
  using (true);

-- 2. Schedule daily pg_cron job for usage_logs 30-day TTL purging
-- Ensure pg_cron extension is loaded
create extension if not exists pg_cron with schema extensions;

-- Safely schedule the daily purge job
do $$
begin
  -- Unschedule existing job if it already exists to prevent duplicate cron runs
  perform cron.unschedule('purge-usage-logs-daily');
exception
  when others then
    -- Catch exception if the job does not exist yet (no-op)
    null;
end;
$$;

select cron.schedule(
  'purge-usage-logs-daily',
  '0 0 * * *',
  $$delete from public.usage_logs where created_at < now() - interval '30 days';$$
);
