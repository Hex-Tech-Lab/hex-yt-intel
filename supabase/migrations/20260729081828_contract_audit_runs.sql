-- contract_audit_runs: one row per contract-auditor execution (CI or local).
--
-- Motivation (2026-07-29): this session found the SAME class of bug five
-- separate times in one day -- a wrong/dead API endpoint that "looked right"
-- (Supabase logs, QStash schedules), a script whose missing-config branch
-- exited 0 so CI reported green while doing nothing (QStash cron
-- registration, silently broken for 2+ months, caught by accident not by
-- process), and a prompt template that pre-scripted a failure outcome for
-- two personas instead of genuinely attempting them. None of these were
-- caught by tsc, lint, or qa-intel's existing rules -- they're contract
-- drift (code assumes X about an external system or its own template, X
-- silently becomes false) rather than a syntax/type/security defect.
--
-- scripts/contract-auditor.ts codifies detectable patterns from this
-- incident class and runs in CI (see .github/workflows/ci-cd.yml) plus
-- on-demand locally. Every run is persisted here so the admin Logs UI has
-- a durable trend, not just the latest run's stdout.
create table if not exists public.contract_audit_runs (
  id              bigint generated always as identity primary key,
  run_at          timestamptz  not null default now(),
  source          text         not null check (source in ('ci', 'local')),
  commit_sha      text,
  critical_count  int          not null default 0,
  warning_count   int          not null default 0,
  findings        jsonb        not null default '[]'::jsonb
);

comment on table public.contract_audit_runs is
  'One row per scripts/contract-auditor.ts run. Operational telemetry, not user data -- RLS-locked with no permissive policy (service_role only), same pattern as public.app_settings / public.upstash_snapshots.';

create index if not exists contract_audit_runs_run_at_idx
  on public.contract_audit_runs (run_at desc);

alter table public.contract_audit_runs enable row level security;
