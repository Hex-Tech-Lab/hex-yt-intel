-- Atomic shallow merge into analyses.validation_report.
-- The UCIS markdown webhook (/api/webhooks/validate) used to REPLACE the whole
-- report after finalize, wiping status, dimension_status, metadata and
-- jev_partial_dimensions (most completed rows since at least 2026-09-21).
-- Callers that add their own key merge through this function instead.
create or replace function public.merge_analysis_validation_report(p_analysis_id uuid, p_patch jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update public.analyses
     set validation_report = coalesce(validation_report, '{}'::jsonb) || p_patch,
         updated_at = now()
   where id = p_analysis_id;
$$;

revoke all on function public.merge_analysis_validation_report(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.merge_analysis_validation_report(uuid, jsonb) to service_role;
