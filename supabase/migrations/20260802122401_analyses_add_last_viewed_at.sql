-- Proactive follow-through on the History card's First/Last date request:
-- viewed_count already exists (increment-only counter, no timestamp), but
-- "when was this last opened" has no answer without a timestamp. Adding
-- last_viewed_at, bumped by the same increment_analysis_view RPC that
-- already bumps viewed_count on every open -- one atomic UPDATE, no new
-- race window.

alter table public.analyses
  add column if not exists last_viewed_at timestamptz;

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
      last_viewed_at = now()
  where id = p_analysis_id
    and user_id = p_user_id;
$$;
