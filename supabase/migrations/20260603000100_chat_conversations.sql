-- Chat conversations + messages — ChatGPT/Claude/Gemini-style threads.
--
-- ARCHITECTURE: Postgres is the durable SOURCE OF TRUTH for conversation history
-- (matches how Claude/OpenAI/Gemini persist threads). Upstash/Redis is a hot-path
-- accelerator only (streaming, rate limit, optional tail cache) — never the store,
-- because it is volatile. The LLM itself is stateless: each turn replays history.
--
-- A conversation OPTIONALLY references an analysis (groundable), but is independent
-- so a user can start a new thread and ask anything, any time, from anywhere.

create table if not exists public.chat_conversations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null default 'New chat',
  analysis_id     uuid references public.analyses(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index if not exists idx_chat_conv_user
  on public.chat_conversations(user_id, last_message_at desc);
create index if not exists idx_chat_conv_analysis
  on public.chat_conversations(analysis_id);

create table if not exists public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant', 'system')),
  content         text not null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_chat_msg_conv
  on public.chat_messages(conversation_id, created_at);

-- Row Level Security: a user may only see/manage their own threads + messages.
alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "own conversations" on public.chat_conversations;
create policy "own conversations" on public.chat_conversations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own messages" on public.chat_messages;
create policy "own messages" on public.chat_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Keep conversation freshness in sync as messages arrive (drives history ordering).
create or replace function public.touch_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.chat_conversations
     set last_message_at = now(), updated_at = now()
   where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists trg_touch_conversation on public.chat_messages;
create trigger trg_touch_conversation
  after insert on public.chat_messages
  for each row execute function public.touch_conversation();

-- The trigger function must not be exposed as a PostgREST RPC. Revoke EXECUTE from
-- API roles; the AFTER INSERT trigger still fires (triggers bypass EXECUTE grants).
revoke execute on function public.touch_conversation() from public, anon, authenticated;
