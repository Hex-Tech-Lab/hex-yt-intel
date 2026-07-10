/**
 * User Knowledge Wiki Table (WAVE 4.2)
 * Stores aggregated wiki articles built from captured user questions.
 * Monthly QStash cron builds these from `/raw/{userId}/questions/*.md` files.
 *
 * ADR: Stores both topic-specific wikis and theme-based FAQ structures.
 * Idempotent: monthly cron upserts by (userId, topic) to avoid duplicates.
 */

create table if not exists public.user_knowledge_wiki (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  topic           text not null,
  wiki_markdown   text not null,
  question_count  integer not null default 0,
  theme_count     integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint topic_not_empty check (char_length(topic) > 0),
  constraint markdown_not_empty check (char_length(wiki_markdown) > 0),
  constraint question_count_non_negative check (question_count >= 0),
  constraint theme_count_non_negative check (theme_count >= 0)
);

-- Composite unique index for idempotent upserts (userId + topic pair)
create unique index if not exists idx_user_knowledge_wiki_unique_topic
  on public.user_knowledge_wiki(user_id, topic);

-- Index for efficient lookups when loading wiki for grounding context
create index if not exists idx_user_knowledge_wiki_by_user
  on public.user_knowledge_wiki(user_id, updated_at desc);

-- Row Level Security: users can only READ their own wikis (mutations via service-role only)
alter table public.user_knowledge_wiki enable row level security;

drop policy if exists "users can read own wikis" on public.user_knowledge_wiki;
create policy "users can read own wikis" on public.user_knowledge_wiki
  for select using (auth.uid() = user_id);

-- Grant authenticated users SELECT access (needed for grounding context loading)
grant select on public.user_knowledge_wiki to authenticated;

-- Grant service-role full access (needed for QStash webhook + wiki builder)
grant all on public.user_knowledge_wiki to service_role;

-- Audit trigger: track updates
create or replace function public.track_wiki_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_track_wiki_update on public.user_knowledge_wiki;
create trigger trg_track_wiki_update
  before update on public.user_knowledge_wiki
  for each row execute function public.track_wiki_update();

revoke execute on function public.track_wiki_update() from public, anon, authenticated;
