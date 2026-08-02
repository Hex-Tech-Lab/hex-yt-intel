-- Real gap found live (2026-08-02): dimension-remediation.ts's token-bucket
-- budget spend had no queryable audit trail -- console.log was the only
-- record of what it actually spent money on. Adding a usage_logs write
-- (SupabaseBillingAdapter.logUsageEvent) needs a distinct action value:
-- reusing 'analysis_completed' would collide with
-- idx_usage_logs_analysis_completed_dedup (unique on
-- metadata->>'analysisId' where action='analysis_completed'), since every
-- remediated analysisId already has one such row from its original
-- completion -- the remediation event would be silently rejected as a
-- duplicate under that action. Same TS-type-vs-schema-drift pattern as the
-- 2026-07-26 chat_turn/analysis_completed fix and the 2026-07-23
-- billing_status contract fix.
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
    'dimension_remediation'::text
  ]));
