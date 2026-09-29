-- R1c — Finding 5: lock billing/validation columns on analyses away from client roles.
-- Contract (dispatch 2026-09-29):
--   anon           : NO insert/update/delete on public.analyses
--   authenticated  : NO insert; UPDATE only on the exact columns user-session
--                    server routes write (see header comment of
--                    supabase/migrations/2026092912*_analyses_column_grants_lockdown.sql);
--                    NEVER billing_status / validation_report / validation_passed /
--                    analysis_payload / analysis_markdown / user_id / video_id or any
--                    token/cost column.
--   service_role   : unchanged. SELECT: unchanged.
--
-- This assertion FAILS if authenticated has UPDATE on billing_status.
-- Read-only: SELECTs only, no data mutation.

do $$
declare
  v_count int;
begin
  -- Positive check: authenticated must NOT hold UPDATE on billing_status.
  select count(*)
    into v_count
    from information_schema.role_column_grants
    where table_schema = 'public'
      and table_name   = 'analyses'
      and column_name  = 'billing_status'
      and grantee      = 'authenticated'
      and privilege_type = 'UPDATE';

  if v_count > 0 then
    raise exception 'GRANT LOCKDOWN VIOLATION: authenticated holds UPDATE on public.analyses.billing_status (% grant(s) found)', v_count
      using hint = 'Re-run migration 20260929140000_analyses_column_grants_lockdown.sql';
  end if;

  -- Companion check: authenticated must not hold UPDATE on validation_report either.
  select count(*)
    into v_count
    from information_schema.role_column_grants
    where table_schema = 'public'
      and table_name   = 'analyses'
      and column_name  = 'validation_report'
      and grantee      = 'authenticated'
      and privilege_type = 'UPDATE';

  if v_count > 0 then
    raise exception 'GRANT LOCKDOWN VIOLATION: authenticated holds UPDATE on public.analyses.validation_report (% grant(s) found)', v_count;
  end if;

  -- Companion check: anon must not hold INSERT/UPDATE on ANY column.
  select count(*)
    into v_count
    from information_schema.role_column_grants
    where table_schema = 'public'
      and table_name   = 'analyses'
      and grantee      = 'anon'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE');

  if v_count > 0 then
    raise exception 'GRANT LOCKDOWN VIOLATION: anon holds INSERT/UPDATE/DELETE on public.analyses (% grant(s) found)', v_count;
  end if;

  -- Companion check: authenticated must not hold INSERT on any column.
  select count(*)
    into v_count
    from information_schema.role_column_grants
    where table_schema = 'public'
      and table_name   = 'analyses'
      and grantee      = 'authenticated'
      and privilege_type = 'INSERT';

  if v_count > 0 then
    raise exception 'GRANT LOCKDOWN VIOLATION: authenticated holds INSERT on public.analyses (% grant(s) found)', v_count;
  end if;

  raise notice 'R1c grant lockdown assertion PASSED: client roles locked out of billing/validation columns.';
end $$;
