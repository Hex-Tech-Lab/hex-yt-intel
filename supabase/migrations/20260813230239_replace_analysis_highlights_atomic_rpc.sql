-- P0 data-loss finding from /pr-review-workflow breakage-hunt on PR #233:
-- saveHighlights did a plain delete-then-insert from the app layer -- if the
-- insert failed after the delete succeeded, a previously valid highlight set
-- was gone with nothing to replace it. Same atomic-RPC pattern already
-- established in this project (update_analysis_result_atomic): a plpgsql
-- function body is one implicit transaction, so an insert failure rolls back
-- the delete too. Verified live: create->replace->rows swap atomically,
-- delete-then-failed-insert leaves nothing orphaned.
create or replace function public.replace_analysis_highlights(
  p_analysis_id uuid,
  p_highlights jsonb
)
returns void
language plpgsql
volatile
security invoker
set search_path = public
as $func$
begin
  delete from public.analysis_highlights where analysis_id = p_analysis_id;

  insert into public.analysis_highlights (analysis_id, idx, start_seconds, end_seconds, label)
  select p_analysis_id, (elem->>'idx')::int, (elem->>'start')::double precision, (elem->>'end')::double precision, elem->>'label'
  from jsonb_array_elements(p_highlights) as elem;
end;
$func$;

revoke execute on function public.replace_analysis_highlights(uuid, jsonb) from anon, authenticated, public;
