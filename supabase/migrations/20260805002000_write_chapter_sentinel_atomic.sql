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
-- Also sets expires_at explicitly (matches the same TTL-refresh fix applied
-- to the real-chapters upsert path in SupabaseTranscriptAdapter.ts -- an
-- ON CONFLICT UPDATE only touches columns it's told to, so without this a
-- repeated empty re-analysis would leave the sentinel on its original TTL)
-- and populates parse_attempted_at, which the schema/docs already promised
-- the sentinel would carry but nothing previously wrote.
create or replace function public.write_chapter_sentinel(p_video_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.transcript_chapters
  where video_id = p_video_id and idx >= 0;

  insert into public.transcript_chapters
    (video_id, idx, start_seconds, end_seconds, label, parse_attempted_at, expires_at)
  values
    (p_video_id, -1, -1, -1, '__attempted_empty__', now(), now() + interval '72 hours')
  on conflict (video_id, idx) do update
    set start_seconds = excluded.start_seconds,
        end_seconds = excluded.end_seconds,
        label = excluded.label,
        parse_attempted_at = excluded.parse_attempted_at,
        expires_at = excluded.expires_at,
        created_at = now();
end;
$$;

revoke execute on function public.write_chapter_sentinel(text) from anon, authenticated, public;

-- Mirror-image atomic write for the REAL-chapters transition (2026-08-05,
-- altitude review on PR #205): write_chapter_sentinel() above only made the
-- empty/sentinel branch atomic -- the real-chapters branch in
-- SupabaseTranscriptAdapter.upsertChapters() still did upsert, sentinel-
-- delete, and stale-row cleanup as three separate PostgREST calls, the same
-- failure class (partial write leaves an inconsistent grey/orange/green
-- state) just on the opposite branch. p_chapters is a jsonb array of
-- {idx, start_seconds, end_seconds, label} objects -- video_id and
-- expires_at are applied uniformly here rather than per-row from the
-- caller, so there's one place that can drift, not N.
create or replace function public.write_real_chapters(p_video_id text, p_chapters jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_expires_at timestamptz := now() + interval '72 hours';
begin
  select jsonb_array_length(p_chapters) into v_count;

  insert into public.transcript_chapters (video_id, idx, start_seconds, end_seconds, label, expires_at)
  select
    p_video_id,
    (elem ->> 'idx')::int,
    (elem ->> 'start_seconds')::double precision,
    (elem ->> 'end_seconds')::double precision,
    elem ->> 'label',
    v_expires_at
  from jsonb_array_elements(p_chapters) as elem
  on conflict (video_id, idx) do update
    set start_seconds = excluded.start_seconds,
        end_seconds = excluded.end_seconds,
        label = excluded.label,
        expires_at = excluded.expires_at;

  -- Remove the "attempted but empty" sentinel (a re-analysis that now found
  -- chapters must flip orange -> green) and any stale rows beyond the
  -- current run's idx range, in the same transaction as the upsert above.
  delete from public.transcript_chapters
  where video_id = p_video_id
    and (idx = -1 or idx >= v_count);
end;
$$;

revoke execute on function public.write_real_chapters(text, jsonb) from anon, authenticated, public;
