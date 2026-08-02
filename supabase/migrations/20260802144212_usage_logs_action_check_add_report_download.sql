-- Live production bug found during PR #178 review triage (2026-08-02):
-- 'report_download' has been used as a usage_logs action since 2026-07-30
-- (web/app/api/analyses/[id]/download-event/route.ts,
-- web/app/api/analyses/[id]/export/route.ts) but was NEVER added to any
-- usage_logs_action_check migration -- every report_download logUsage call
-- has been silently rejected by the CHECK constraint since it was
-- introduced, and the write is fire-and-forget (never awaited, failure
-- never surfaced), so this has been silently dropping telemetry in
-- production with no alert for days. Cubic flagged the adjacent PR #178
-- migration (20260802122006, adding 'dimension_remediation') for the same
-- gap; verified live against the actual deployed constraint that
-- report_download really is still missing today, independent of whether
-- #178 merges.
alter table public.usage_logs drop constraint usage_logs_action_check;

alter table public.usage_logs add constraint usage_logs_action_check
  check (action = any (array[
    'analysis'::text,
    'analysis_completed'::text,
    'chat_turn'::text,
    'search'::text,
    'export'::text,
    'api_call'::text,
    'embedding_generation'::text,
    'checkout_initiated'::text,
    'invoice_paid'::text,
    'invoice_failed'::text,
    'subscription_created'::text,
    'subscription_updated'::text,
    'subscription_deleted'::text,
    'subscription_canceled'::text,
    'monthly_quota_exceeded'::text,
    'rate_limit_exceeded'::text,
    'admin_stats_viewed'::text,
    'dimension_remediation'::text,
    'report_download'::text
  ]));
