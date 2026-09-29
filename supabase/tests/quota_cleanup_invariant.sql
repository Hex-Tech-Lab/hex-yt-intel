-- R1f: free-tier cleanup must never delete rows inside the current quota
-- window (reserve_analysis_quota counts rows since date_trunc('month', now())).
-- Asserts both cleanup paths carry the month boundary. Read-only.
do $$
begin
  if pg_get_functiondef('public.delete_old_free_analyses'::regproc) !~* 'date_trunc\(''month''' then
    raise exception 'QUOTA INVARIANT VIOLATION: delete_old_free_analyses() lacks the current-month boundary';
  end if;
  if not exists (
    select 1 from cron.job
    where jobname = 'delete-old-free-analyses' and command ~* 'date_trunc\(''month'''
  ) then
    raise exception 'QUOTA INVARIANT VIOLATION: cron delete-old-free-analyses lacks the current-month boundary';
  end if;
  raise notice 'R1f quota cleanup invariant PASSED';
end $$;
