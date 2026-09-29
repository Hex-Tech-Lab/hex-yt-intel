-- R1f: make the free-tier cleanup quota-safe.
--
-- reserve_analysis_quota counts a user's completed analyses created since
-- date_trunc('month', now()). Free-tier cleanup (the nightly pg_cron job
-- 'delete-old-free-analyses' AND the delete_old_free_analyses() trigger on
-- public.analyses, trigger_delete_old_analyses) deleted free rows older than
-- 30 days. In a 31-day month a row created on the 1st is > 30 days old by the
-- 31st, so cleanup deleted a row that still counted toward THIS month's quota
-- and silently refunded it.
--
-- Invariant: cleanup may only delete rows that are BOTH older than 30 days
-- AND created before the current quota window (the calendar month, same
-- date_trunc/timezone as reserve_analysis_quota).

create or replace function public.delete_old_free_analyses()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $$
begin
  delete from analyses
  where user_id in (select id from users where tier = 'free')
    and created_at < least(now() - interval '30 days', date_trunc('month', now()));
  return null;
end;
$$;

-- pg_cron >= 1.4 upserts by job name (live: 1.6.4).
select cron.schedule(
  'delete-old-free-analyses',
  '0 2 * * *',
  $cmd$DELETE FROM analyses WHERE user_id IN (SELECT id FROM users WHERE tier = 'free') AND created_at < least(NOW() - INTERVAL '30 days', date_trunc('month', NOW()))$cmd$
);
