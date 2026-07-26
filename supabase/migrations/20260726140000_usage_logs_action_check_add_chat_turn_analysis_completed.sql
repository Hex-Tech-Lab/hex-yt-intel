-- RCA (2026-07-26): usage_logs.action CHECK constraint never included
-- 'chat_turn' (ProcessChatMessageUseCase.ts) or 'analysis_completed'
-- (PostgresBillingAdapter.ts) -- both silently failed to insert on every
-- call (caught by a .catch() so the surrounding feature kept working, but
-- usage/billing tracking for chat turns and analysis completions has been
-- completely blind since those call sites were added). Same TS-type-vs-
-- schema-drift pattern as the billing_status contract fix (2026-07-23).
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
    'admin_stats_viewed'::text
  ]));
