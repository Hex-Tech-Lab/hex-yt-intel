-- Wire the `viewed_count` column (added in 20260704000000_history_overview_columns)
-- to a real writer. The history overview surfaces "Views" as
-- sum(viewed_count) per base video, but nothing incremented it, so the chip
-- always read 0.
--
-- Atomic single-statement increment (col = col + 1) — a read-modify-write from
-- the app would race concurrent opens and lose counts. Keyed on BOTH id and
-- user_id as defense in depth: even though the caller (GET /api/analyses/[id])
-- already verifies ownership before invoking this, the predicate guarantees a
-- caller can only ever bump a row they own.
--
-- security invoker: called via the service client, so RLS is bypassed; the
-- explicit user_id predicate is what scopes the write.

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
  set viewed_count = coalesce(viewed_count, 0) + 1
  where id = p_analysis_id
    and user_id = p_user_id;
$$;
