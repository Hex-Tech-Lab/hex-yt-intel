-- DB Hardening (Group A) — resolves Supabase advisor findings without changing the
-- effective access model:
--   * auth_rls_initplan (x10): legacy policies call bare auth.uid()/auth.role(),
--     re-evaluated per row. The newer snake_case policies already wrap them as
--     (select auth.<fn>()). We drop the legacy duplicates and wrap the two chat
--     policies that had no wrapped equivalent.
--   * multiple_permissive_policies (x48): the same legacy/snake_case duplication
--     produced two permissive policies per (table, role, command). Dropping the
--     legacy set collapses each to a single permissive policy.
--   * unindexed_foreign_keys: add a covering index for chat_messages.user_id.
--   * usage_logs CHECK mismatch: the constraint rejected several action values the
--     application actually emits (rate_limit_exceeded, monthly_quota_exceeded,
--     admin_stats_viewed, subscription_canceled, invoice_failed), silently dropping
--     those observability rows. Expand the allowlist to the full emitted set.
--
-- SAFETY: the retained snake_case policies additionally require
-- auth.role() = 'authenticated', a strict superset-restriction of the legacy
-- auth.uid() = user_id check — no access regression for real authenticated users;
-- service_role bypasses RLS entirely, so server-side writes are unaffected.

-- 1) Drop legacy duplicate policies (wrapped snake_case equivalents remain) -----
drop policy if exists "Users can read own analyses"  on public.analyses;
drop policy if exists "Users can create analyses"    on public.analyses;
drop policy if exists "Users can update own analyses" on public.analyses;
drop policy if exists "Users can delete own analyses" on public.analyses;

drop policy if exists "System can write usage logs"   on public.usage_logs;
drop policy if exists "Users can read own usage logs" on public.usage_logs;

drop policy if exists "Users can read own data"   on public.users;
drop policy if exists "Users can update own data" on public.users;

-- 2) Recreate the chat policies with wrapped auth.uid() (init-plan perf) --------
drop policy if exists "own conversations" on public.chat_conversations;
create policy "own conversations" on public.chat_conversations
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "own messages" on public.chat_messages;
create policy "own messages" on public.chat_messages
  for all
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.chat_conversations c
      where c.id = chat_messages.conversation_id and c.user_id = (select auth.uid())
    )
  );

-- 3) Covering index for the chat_messages.user_id foreign key -------------------
create index if not exists idx_chat_messages_user_id on public.chat_messages (user_id);

-- 4) Expand usage_logs.action allowlist to the full set the app emits -----------
alter table public.usage_logs drop constraint if exists usage_logs_action_check;
alter table public.usage_logs add constraint usage_logs_action_check
  check (action = any (array[
    'analysis',
    'search',
    'export',
    'api_call',
    'embedding_generation',
    'checkout_initiated',
    'invoice_paid',
    'invoice_failed',
    'subscription_created',
    'subscription_updated',
    'subscription_deleted',
    'subscription_canceled',
    'monthly_quota_exceeded',
    'rate_limit_exceeded',
    'admin_stats_viewed'
  ]));
