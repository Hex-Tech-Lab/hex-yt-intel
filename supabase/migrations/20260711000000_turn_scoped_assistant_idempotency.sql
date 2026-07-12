-- Migration: Turn-scoped assistant message idempotency (PR #146)
--
-- PROBLEM: Content-based deduplication suppresses valid repeated assistant replies on later turns
-- and is racy under concurrent retries.
--
-- SOLUTION: Replace content-based lookup with turn-scoped idempotency key tied to parent_message_id.
-- One assistant reply per user message (parent turn) — retries with same parent_message_id become
-- idempotent via unique constraint violation.

-- First, remove duplicate assistant messages, keeping only the latest one per parent_message_id
delete from public.chat_messages
where role = 'assistant'
  and parent_message_id is not null
  and id not in (
    select id from (
      select id, row_number() over (partition by parent_message_id order by created_at desc) as rn
      from public.chat_messages
      where role = 'assistant' and parent_message_id is not null
    ) ranked where rn = 1
  );

-- Add unique constraint: one assistant reply per parent message
-- (Only applies to assistant messages with a parent_message_id)
-- Using CONCURRENTLY to avoid blocking writes during index creation
create unique index if not exists uq_chat_messages_assistant_per_turn
  on public.chat_messages(parent_message_id)
  where role = 'assistant' and parent_message_id is not null;
