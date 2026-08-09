-- Real, live-verified findings from docs/audit/DB_ARCH_10X_AUDIT_2026-08-09_VERIFIED.md
-- (db-arch-10x v1.4, independently re-verified by CC via get_advisors + pg_proc.prosrc
-- before applying -- not trusted from the report alone).

-- M1: 3 SECURITY DEFINER functions were callable by anon/authenticated with no need
-- for either role -- same bug class as PR #179's missing REVOKE EXECUTE incident.
-- compliance_check_transcripts(): read-only report, harmless if called but pointless
--   to expose; purge_expired_transcripts(): DELETE operation, meant to be a cron/admin
--   maintenance function, not user-triggerable; log_setting_value_change(): a TRIGGER
--   function (returns trigger, references NEW/OLD) that should never be directly
--   RPC-callable at all -- its presence in the anon/authenticated-callable list was
--   pure accidental PostgREST exposure, not intentional API surface.
revoke execute on function public.compliance_check_transcripts() from anon, authenticated, public;
revoke execute on function public.purge_expired_transcripts() from anon, authenticated, public;
revoke execute on function public.log_setting_value_change() from anon, authenticated, public;

-- M2: 4 of 7 RLS-enabled-no-policy tables had no comment confirming the lockdown is
-- intentional (service_role-only), unlike their 3 documented siblings
-- (app_settings/contract_audit_runs/upstash_snapshots). Real content, not fabricated:
-- transcripts/transcript_markers/transcript_chapters are the ADR 012 ephemeral 72h
-- transcript cache (worker-only writes, service_role reads); estimate_reconciliation_log
-- is comment-sampling estimate-vs-actual audit telemetry (comments_sampling_engine
-- migration), same operational-log shape as contract_audit_runs/upstash_snapshots.
comment on table public.transcripts is
  'Ephemeral 72h transcript cache (ADR 012), keyed by video_id. Worker-only writes, service_role reads -- RLS-locked with no permissive policy (service_role only), same pattern as public.app_settings.';
comment on table public.transcript_markers is
  'Ephemeral 72h transcript keyword/entity markers (ADR 012), tied to public.transcripts via video_id. RLS-locked with no permissive policy (service_role only), same pattern as public.app_settings.';
comment on table public.transcript_chapters is
  'Ephemeral 72h transcript chapter boundaries, tied to public.transcripts via video_id. RLS-locked with no permissive policy (service_role only), same pattern as public.app_settings.';
comment on table public.estimate_reconciliation_log is
  'Comment-sampling estimate-vs-actual reconciliation audit trail (comments_sampling_engine). Operational telemetry, not user-facing data -- RLS-locked with no permissive policy (service_role only), same pattern as public.contract_audit_runs / public.upstash_snapshots.';
