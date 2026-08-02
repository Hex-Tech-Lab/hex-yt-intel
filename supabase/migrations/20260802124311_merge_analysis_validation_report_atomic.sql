-- RCA (2026-08-02, live-reported by user, "92% failing" chip desync):
-- persist/route.ts's channelMeta/comments write into validation_report was
-- a classic concurrent read-modify-write race: SELECT priorReport (a
-- point-in-time snapshot) -> merge in JS (`channelMeta ?? priorReport.channelMeta`)
-- -> blind UPDATE overwriting the whole column. The app's own architecture
-- sends MULTIPLE concurrent chunk-persist requests per analysisId (parallel
-- dimension streaming) -- whichever request's SELECT happened first but
-- UPDATE commits last wins, silently clobbering an earlier concurrent
-- request's channelMeta/comments with its own stale snapshot. Verified live:
-- 34 of 37 recent completions (92%) had neither key in validation_report at
-- all, including analyses completed the same day.
--
-- Real fix, not a workaround: atomic SQL-level JSONB merge instead of
-- application-level read-then-write. `||` is a single UPDATE statement --
-- Postgres serializes concurrent UPDATEs to the same row via normal MVCC/
-- row-locking, so there is no window for a second writer to read a stale
-- snapshot of a value the first writer already committed. Callers now pass
-- a PATCH (only the fields they have fresh values for) instead of a fully
-- pre-merged object; keys omitted from the patch are left untouched in the
-- DB rather than being reconstructed from an in-memory stale copy.
create or replace function public.merge_analysis_validation_report(
  p_analysis_id uuid,
  p_patch jsonb,
  p_guard_billing_status text default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
begin
  update public.analyses
  set validation_report = coalesce(validation_report, '{}'::jsonb) || p_patch,
      updated_at = now()
  where id = p_analysis_id
    and (p_guard_billing_status is null or billing_status = p_guard_billing_status)
  returning validation_report into v_result;

  return v_result; -- null if no row matched (guard failed or id not found) -- caller treats as "not updated"
end;
$$;
