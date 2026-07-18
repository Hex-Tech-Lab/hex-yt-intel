-- Transcripts + Markers for 72h retention + TimeSeek

create table if not exists public.transcripts (
  video_id text primary key,
  content text not null,
  segments jsonb not null default '[]'::jsonb,
  language text default 'en',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '72 hours'),
  last_accessed_at timestamptz not null default now(),
  transcript_hash text
);

create index if not exists idx_transcripts_expires_at on public.transcripts(expires_at);
create index if not exists idx_transcripts_hash on public.transcripts(transcript_hash);

create table if not exists public.transcript_markers (
  id uuid primary key default gen_random_uuid(),
  video_id text not null,
  idx int not null,
  start_seconds double precision not null,
  end_seconds double precision not null,
  keywords text[] not null default '{}',
  entities text[] not null default '{}',
  quote_hash text not null,
  importance double precision not null default 0.5,
  dim_refs int[] not null default '{}',
  genre text not null default 'unknown',
  source text not null default 'drift',
  created_at timestamptz not null default now(),
  unique(video_id, idx)
);

create index if not exists idx_markers_video_id on public.transcript_markers(video_id);
create index if not exists idx_markers_start on public.transcript_markers(video_id, start_seconds);
create index if not exists idx_markers_importance on public.transcript_markers(video_id, importance desc);
create index if not exists idx_markers_genre on public.transcript_markers(genre);

alter table public.transcripts enable row level security;
alter table public.transcript_markers enable row level security;

-- no policies on purpose — service_role bypasses RLS; anon/authenticated fully blocked.

-- Purge function for cron
create or replace function public.purge_expired_transcripts()
returns table(video_id text, deleted_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  delete from public.transcripts
  where expires_at < now()
  returning transcripts.video_id, now();
end;
$$;

-- Compliance check
create or replace function public.compliance_check_transcripts()
returns table(violations bigint, max_age interval)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select count(*), max(now() - expires_at)
  from public.transcripts
  where expires_at < now();
end;
$$;
