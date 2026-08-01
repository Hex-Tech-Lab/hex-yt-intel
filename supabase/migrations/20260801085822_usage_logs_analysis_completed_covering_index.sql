-- Flagged independently by both supabase-postgres-best-practices and the
-- /simplify efficiency review (PR #175): admin_list_users_activity()'s new
-- per-user cost lateral join filters usage_logs by (user_id, action), but
-- only idx_usage_logs_user_id (user_id-only) existed -- each user's full
-- log history got scanned and action-filtered in-memory instead of via
-- index. Partial index mirrors the shape already used by
-- idx_usage_logs_analysis_completed_dedup.
create index if not exists idx_usage_logs_user_analysis_completed
  on public.usage_logs (user_id)
  where action = 'analysis_completed';
