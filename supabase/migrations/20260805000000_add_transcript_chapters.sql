-- Chapters extracted from YouTube video descriptions
-- Same 72h TTL/purge pattern as public.transcripts (migration 20260718000000)

create table if not exists public.transcript_chapters (
  video_id text not null,
  idx int not null,
  start_seconds double precision not null,
  end_seconds double precision not null,
  label text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '72 hours'),
  unique(video_id, idx)
);

create index if not exists idx_chapters_video_id on public.transcript_chapters(video_id);
create index if not exists idx_chapters_start on public.transcript_chapters(video_id, start_seconds);
create index if not exists idx_chapters_expires_at on public.transcript_chapters(expires_at);

alter table public.transcript_chapters enable row level security;

-- no policies — service_role bypasses RLS; anon/authenticated fully blocked.

-- Purge function for cron
create or replace function public.purge_expired_chapters()
returns table(video_id text, deleted_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  delete from public.transcript_chapters
  where expires_at < now()
  returning transcript_chapters.video_id, now();
end;
$$;

revoke execute on function public.purge_expired_chapters() from anon, authenticated, public;

-- Compliance check
create or replace function public.compliance_check_chapters()
returns table(violations bigint, max_age interval)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select count(*), max(now() - expires_at)
  from public.transcript_chapters
  where expires_at < now();
end;
$$;

revoke execute on function public.compliance_check_chapters() from anon, authenticated, public;