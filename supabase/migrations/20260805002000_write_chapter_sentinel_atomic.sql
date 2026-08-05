-- Atomic "attempted but empty" chapter transition. Fixes a real gap flagged
-- by review on PR #205 (2026-08-05): SupabaseTranscriptAdapter.upsertChapters
-- previously did the delete-real-rows and upsert-sentinel steps as two
-- separate PostgREST calls. If the sentinel upsert failed after the delete
-- succeeded, the video was left with NO chapter rows at all -- history falls
-- back to grey (never-attempted) instead of orange (attempted, empty), and
-- any real chapter boundaries from a prior analysis are already gone with no
-- way to tell the two failure modes apart from the caller's error handling.
-- Wrapping both statements in a single plpgsql function makes the transition
-- atomic: it's a single transaction from PostgREST's perspective, so a
-- mid-way failure rolls back the delete too.
create or replace function public.write_chapter_sentinel(p_video_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.transcript_chapters
  where video_id = p_video_id and idx >= 0;

  insert into public.transcript_chapters (video_id, idx, start_seconds, end_seconds, label)
  values (p_video_id, -1, -1, -1, '__attempted_empty__')
  on conflict (video_id, idx) do update
    set start_seconds = excluded.start_seconds,
        end_seconds = excluded.end_seconds,
        label = excluded.label,
        created_at = now();
end;
$$;

revoke execute on function public.write_chapter_sentinel(text) from anon, authenticated, public;
