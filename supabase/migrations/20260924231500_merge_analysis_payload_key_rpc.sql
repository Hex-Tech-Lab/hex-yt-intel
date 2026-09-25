-- PR #322 round-2 review fix (P1): analysis_payload key-merge RPC.
-- The relations route and backfill previously read the whole analysis_payload,
-- spread it into a fresh object with stance_relations added, and wrote the
-- merged object back. Any concurrent payload write (persist finalize,
-- highlights, remediation) landing between the read and the write was
-- silently lost. This RPC performs the merge database-side via jsonb_set so
-- only the target key is touched, atomically.
--
-- Contract:
--   p_id    = analyses.id (uuid)
--   p_key   = top-level analysis_payload key to set (alphanumeric/underscore,
--             <= 64 chars -- guards against jsonb path injection)
--   p_value = jsonb value to set
--   Returns the number of rows updated (0 = no matching row) so callers can
--   verify the write actually landed instead of a silent zero-row update.
--
-- Authorization (SECURITY DEFINER -- analyses RLS applies to the definer,
-- not the caller, so the role check must be explicit):
--   service_role (scripts, S2S persist): unrestricted.
--   authenticated: only rows the caller owns (user_id = auth.uid()).
--   anon / public: denied entirely.

create or replace function public.merge_analysis_payload_key(
  p_id uuid,
  p_key text,
  p_value jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  if p_key is null or p_key !~ '^[a-zA-Z0-9_]{1,64}$' then
    raise exception 'merge_analysis_payload_key: invalid payload key';
  end if;
  -- CC review (2026-09-24): this function is callable by any authenticated
  -- user (the relations route uses the request-scoped client), so without an
  -- allowlist a user could overwrite ANY top-level key of their own analysis
  -- (dimensions, digest, highlights -- including shared/public reports)
  -- straight from the browser. Only client-computable, non-authoritative keys
  -- may be merged here; add a key deliberately, with review.
  if p_key not in ('stance_relations') then
    raise exception 'merge_analysis_payload_key: key % is not merge-allowed', p_key;
  end if;
  if p_value is null then
    raise exception 'merge_analysis_payload_key: null payload value not allowed';
  end if;

  update public.analyses a
    set analysis_payload = jsonb_set(
          coalesce(a.analysis_payload, '{}'::jsonb),
          array[p_key],
          p_value,
          true
        )
    where a.id = p_id
      and (
        auth.role() = 'service_role'
        or (auth.uid() is not null and a.user_id = auth.uid())
      );

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke execute on function public.merge_analysis_payload_key(uuid, text, jsonb) from anon, public;
grant execute on function public.merge_analysis_payload_key(uuid, text, jsonb) to authenticated, service_role;
