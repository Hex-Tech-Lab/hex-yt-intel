-- RCA (2026-08-02) continued: the first attempt at fixing the validation_report
-- concurrent-write race (merge_analysis_validation_report, 20260802124311) split
-- updateAnalysisResult into TWO statements -- an RPC merge for validation_report,
-- then a separate .update() for markdown/payload/model/validation_passed/
-- billing_status. That is a strictly worse race: a concurrent writer can now
-- commit between the two statements, and a crash/timeout between them leaves
-- the row half-updated (validation_report patched, everything else stale).
--
-- Real fix: ONE atomic UPDATE statement that does everything updateAnalysisResult
-- touches. validation_report merges via `||` (patch semantics, omitted keys
-- preserved); every other field is a plain assignment (these were never
-- accumulated cross-request, so no merge semantics needed there). Postgres
-- serializes concurrent UPDATEs to the same row via MVCC/row-locking, so there
-- is no window between "read" and "write" for a second writer to interleave.
drop function if exists public.merge_analysis_validation_report(uuid, jsonb, text);

create or replace function public.update_analysis_result_atomic(
  p_analysis_id uuid,
  p_markdown text,
  p_payload jsonb,
  p_model text,
  p_validation_passed boolean,
  p_validation_report_patch jsonb,
  p_billing_status text,
  p_guard_billing_status text default null
)
returns table (updated boolean, validation_report jsonb)
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_report jsonb;
  v_count int;
begin
  update public.analyses a
  set analysis_markdown = p_markdown,
      analysis_payload = p_payload,
      model_used = coalesce(p_model, 'edge-stream'),
      validation_passed = p_validation_passed,
      validation_report = coalesce(a.validation_report, '{}'::jsonb) || p_validation_report_patch,
      billing_status = p_billing_status,
      updated_at = now()
  where a.id = p_analysis_id
    and (p_guard_billing_status is null or a.billing_status = p_guard_billing_status)
  returning a.validation_report into v_report;

  get diagnostics v_count = row_count;
  return query select (v_count > 0), v_report;
end;
$$;
