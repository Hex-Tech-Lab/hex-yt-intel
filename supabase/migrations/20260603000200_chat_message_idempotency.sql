-- Client-generated idempotency key so offline-outbox retries never double-insert.
-- The client mints a UUID per message, queues it locally, and replays on reconnect;
-- the unique index makes the server INSERT idempotent.
alter table public.chat_messages add column if not exists client_msg_id uuid;

create unique index if not exists uq_chat_msg_client
  on public.chat_messages(client_msg_id)
  where client_msg_id is not null;
