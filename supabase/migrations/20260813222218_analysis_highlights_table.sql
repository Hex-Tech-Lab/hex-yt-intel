-- Highlights-reel data: timestamped keypoints for the auto-scrubber
-- (task #14, docs/private/2026-08-13_1539_v2_HIGHLIGHTS_REEL_SHARE_WORKFLOW_SPEC.md).
-- Same shape as transcript_chapters (idx/start_seconds/end_seconds/label) but
-- different semantics (AI-extracted noteworthy moments, not creator chapter
-- markers) and no purge -- these are synthesized commentary referencing a
-- timestamp, not a copy of source text, so they follow the same retention as
-- the rest of the analysis output (decided 2026-08-14, see spec doc).
create table if not exists public.analysis_highlights (
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  idx int not null,
  start_seconds double precision not null,
  end_seconds double precision not null,
  label text not null,
  created_at timestamptz not null default now(),
  unique(analysis_id, idx)
);
create index if not exists idx_analysis_highlights_analysis_id on public.analysis_highlights(analysis_id);
alter table public.analysis_highlights enable row level security;
create policy "owner can read own highlights" on public.analysis_highlights for select to authenticated
  using (analysis_id in (select id from public.analyses where user_id = auth.uid()));
revoke all on public.analysis_highlights from anon, public;
revoke insert, update, delete on public.analysis_highlights from authenticated;
