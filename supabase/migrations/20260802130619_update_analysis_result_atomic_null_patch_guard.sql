-- Breakage-hunt finding (PR #179 second review pass, confirmed live):
-- `jsonb || NULL` is NULL-strict in Postgres -- `coalesce(a.validation_report,
-- '{}'::jsonb) || p_validation_report_patch` silently WIPES validation_report
-- to NULL if the caller ever passes a null/omitted patch, which is exactly the
-- field this whole PR exists to protect. No current caller passes null
-- (SupabasePersistenceAdapter always constructs an object), but the RPC's own
-- contract should be "no patch = no change", not "no patch = wipe everything",
-- regardless of caller discipline.
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
      validation_report = coalesce(a.validation_report, '{}'::jsonb) || coalesce(p_validation_report_patch, '{}'::jsonb),
      billing_status = p_billing_status,
      updated_at = now()
  where a.id = p_analysis_id
    and (p_guard_billing_status is null or a.billing_status = p_guard_billing_status)
  returning a.validation_report into v_report;

  get diagnostics v_count = row_count;
  return query select (v_count > 0), v_report;
end;
$$;

revoke execute on function public.update_analysis_result_atomic(uuid, text, jsonb, text, boolean, jsonb, text, text) from anon, authenticated, public;
