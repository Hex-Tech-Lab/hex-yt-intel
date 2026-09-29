-- R1c — Finding 5: lock billing/validation columns on analyses away from client roles.
-- Contract (dispatch 2026-09-29, migration 20260929140000_analyses_column_grants_lockdown.sql):
--   anon           : NO insert/update/delete on public.analyses
--   authenticated  : NO insert; UPDATE only on shared_token + shared_expires_at
--                    (the share route, the only user-session writer)
--   service_role   : unchanged. SELECT: unchanged.
--
-- Uses has_column_privilege / has_table_privilege (EFFECTIVE privileges), not
-- information_schema.role_column_grants: the latter never lists DELETE and
-- only checks the columns you name, so a later grant on analysis_payload or an
-- anon DELETE would slip past it (CodeRabbit, PR #363).
-- Read-only: privilege checks only, no data mutation.

do $$
declare
  v_col text;
  v_allowed constant text[] := array['shared_token', 'shared_expires_at'];
begin
  for v_col in
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'analyses'
  loop
    if has_column_privilege('authenticated', 'public.analyses', v_col, 'UPDATE')
       and not (v_col = any (v_allowed)) then
      raise exception 'GRANT LOCKDOWN VIOLATION: authenticated can UPDATE public.analyses.% (allowlist: %)', v_col, v_allowed
        using hint = 'Re-run migration 20260929140000_analyses_column_grants_lockdown.sql';
    end if;
    if has_column_privilege('anon', 'public.analyses', v_col, 'UPDATE') then
      raise exception 'GRANT LOCKDOWN VIOLATION: anon can UPDATE public.analyses.%', v_col;
    end if;
  end loop;

  if has_table_privilege('anon', 'public.analyses', 'INSERT')
     or has_table_privilege('anon', 'public.analyses', 'DELETE') then
    raise exception 'GRANT LOCKDOWN VIOLATION: anon can INSERT or DELETE on public.analyses';
  end if;

  if has_table_privilege('authenticated', 'public.analyses', 'INSERT') then
    raise exception 'GRANT LOCKDOWN VIOLATION: authenticated can INSERT on public.analyses';
  end if;

  raise notice 'R1c grant lockdown assertion PASSED: client roles locked out of billing/validation columns.';
end $$;
