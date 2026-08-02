-- Cubic review, PR #178: `now()` is transaction-scoped (returns transaction
-- START time, not statement execution time) -- under real concurrency, a
-- transaction that started EARLIER but commits LATER (e.g. lock contention)
-- could overwrite a newer last_viewed_at with an older timestamp, making
-- "last viewed" go backward. statement_timestamp() reads the actual wall
-- clock at execution instead of the cached transaction-start value, and the
-- greatest() guard makes the write monotonic even if two statements somehow
-- still interleave unfavorably.
create or replace function public.increment_analysis_view(
  p_analysis_id uuid,
  p_user_id uuid
)
returns void
language sql
volatile
security invoker
set search_path = public
as $$
  update public.analyses
  set viewed_count = coalesce(viewed_count, 0) + 1,
      last_viewed_at = greatest(coalesce(last_viewed_at, statement_timestamp()), statement_timestamp())
  where id = p_analysis_id
    and user_id = p_user_id;
$$;
