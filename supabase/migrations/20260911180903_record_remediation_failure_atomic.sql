-- PR #310 post-merge review, P1c (2026-09-11): recordRemediationFailure used
-- to write the FULL validation_report object it had snapshotted at
-- candidate-selection time, guarded only by billing_status + retry_count.
-- A concurrent writer that changed OTHER validation_report fields between
-- that read and write (billing_status and retry_count unchanged) had its
-- changes silently clobbered by the stale full-report snapshot.
--
-- Fix: perform the counter bump as ONE atomic UPDATE that merges ONLY the
-- fields the failure-recorder owns (remediation_retry_count,
-- remediation_last_failure_at, remediation_last_failure_stage) into the row's
-- CURRENT jsonb value — there is no stale snapshot to clobber with. Postgres
-- row-locking serializes concurrent UPDATEs to the same row (same MVCC
-- argument as update_analysis_result_atomic, 20260802124438).
--
-- The expected-retry-count CAS mirrors the PostgREST OR-filter it replaces:
-- count 0 matches a row whose counter is absent or literally 0 (PostgREST
-- OR-filter edge case documented on fe88a805); count N > 0 matches an exact
-- N. Comparisons are TEXT equality (canonical integer text written only by
-- our own code), never ::int casts inside the WHERE, so a malformed
-- legacy value can't throw 22P02 and abort the sweep. The guarded rows are
-- by construction numeric, so the ::int in the SET is safe.
--
-- A non-object validation_report (array/scalar — never written by any current
-- code path, but defensively handled exactly like the previous JS side did
-- via asReportObject) is replaced with a fresh object carrying the failure
-- fields, so the counter still lands.
create or replace function public.record_remediation_failure(
  p_analysis_id uuid,
  p_guard_billing_status text,
  p_expected_retry_count int,
  p_failure_stage text,
  p_failed_at timestamptz
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_count int;
begin
  update public.analyses a
  set validation_report = case
        when coalesce(jsonb_typeof(a.validation_report), 'null') = 'object' then
          jsonb_set(
            jsonb_set(
              jsonb_set(
                a.validation_report,
                '{remediation_retry_count}',
                to_jsonb(coalesce((a.validation_report->>'remediation_retry_count')::int, 0) + 1)
              ),
              '{remediation_last_failure_at}',
              to_jsonb(p_failed_at)
            ),
            '{remediation_last_failure_stage}',
            to_jsonb(p_failure_stage)
          )
        else
          jsonb_build_object(
            'remediation_retry_count', 1,
            'remediation_last_failure_at', p_failed_at,
            'remediation_last_failure_stage', p_failure_stage
          )
      end,
      updated_at = now()
  where a.id = p_analysis_id
    and a.billing_status = p_guard_billing_status
    and (
      (p_expected_retry_count = 0 and coalesce(a.validation_report->>'remediation_retry_count', '0') = '0')
      or (p_expected_retry_count > 0 and a.validation_report->>'remediation_retry_count' = p_expected_retry_count::text)
    );

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

-- Same owasp posture as update_analysis_result_atomic (20260802125410):
-- Postgres grants EXECUTE on new functions to PUBLIC by default. This
-- function is only ever meant to be called server-side via the service-role
-- client, which is unaffected by this revoke.
revoke execute on function public.record_remediation_failure(uuid, text, int, text, timestamptz) from anon, authenticated, public;
