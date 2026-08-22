-- Add takeaway_idx and verbatim_excerpt to analysis_highlights (2026-08-21).
--
-- takeaway_idx (smallint, nullable): maps each highlight to the digest
-- takeaway it grounds (0-indexed, matching the executive_digest.takeaways[]
-- array order). NULL = standalone highlight (important but not mapped to a
-- specific takeaway). Backward-compatible: old rows have NULL.
--
-- verbatim_excerpt (text, nullable): the actual transcript text for this
-- highlight's [start, end] window, derived in code from the transcript
-- segments (not LLM-synthesized -- zero additional LLM cost). The ticker
-- (useHighlightTicker) prefers this over the LLM-synthesized label when
-- available. Backward-compatible: old rows have NULL, the ticker falls
-- back to label.
--
-- Both columns are added additively (IF NOT EXISTS) so existing rows and
-- existing queries are unaffected.

alter table public.analysis_highlights
  add column if not exists takeaway_idx smallint;

alter table public.analysis_highlights
  add column if not exists verbatim_excerpt text;

-- Update the atomic replace RPC to accept and insert both new fields from
-- the JSON payload. The old RPC (20260813230239) only inserted
-- (analysis_id, idx, start_seconds, end_seconds, label) -- takeaway_idx
-- and verbatim_excerpt were absent, so new rows always had NULL for both
-- even when the caller's JSON included them. This update adds the two new
-- columns to the INSERT.
--
-- nullif(..., '') handles the case where the caller's JSON has an empty
-- string (TypeScript's optional fields serialize to undefined → JSON omits
-- the key → jsonb ->>'' returns null, which ::smallint/::text accept as
-- NULL; the nullif is belt-and-suspenders for the empty-string edge case
-- where a caller explicitly sent '').
create or replace function public.replace_analysis_highlights(
  p_analysis_id uuid,
  p_highlights jsonb
) returns void as $func$
begin
  delete from public.analysis_highlights where analysis_id = p_analysis_id;

  insert into public.analysis_highlights (analysis_id, idx, start_seconds, end_seconds, label, takeaway_idx, verbatim_excerpt)
  select
    p_analysis_id,
    (elem->>'idx')::int,
    (elem->>'start')::double precision,
    (elem->>'end')::double precision,
    elem->>'label',
    nullif(elem->>'takeaway_idx', '')::smallint,
    nullif(elem->>'verbatim_excerpt', '')::text
  from jsonb_array_elements(p_highlights) as elem;
end;
$func$ language plpgsql volatile security invoker set search_path = public;

revoke execute on function public.replace_analysis_highlights(uuid, jsonb) from anon, authenticated, public;

-- set_executive_digest_reconciliation: atomic targeted jsonb sub-field
-- update on executive_digest.reconciliation only. Avoids clobbering
-- snapshot/overview/takeaways/detailedSummary written concurrently by
-- saveExecutiveDigest (the reconciliation pass runs after extractHighlights,
-- which can race a concurrent re-gen). security invoker (service-role-only,
-- matches replace_analysis_highlights). The coalesce handles the
-- theoretically-empty-but-not-null case from older digest writes.
create or replace function public.set_executive_digest_reconciliation(
  p_analysis_id uuid,
  p_reconciliation jsonb
) returns void as $func$
begin
  update public.analyses
    set executive_digest = jsonb_set(
      coalesce(executive_digest, '{}'::jsonb),
      '{reconciliation}',
      p_reconciliation
    )
    where id = p_analysis_id;
end;
$func$ language plpgsql volatile security invoker set search_path = public;

revoke execute on function public.set_executive_digest_reconciliation(uuid, jsonb) from anon, authenticated, public;
