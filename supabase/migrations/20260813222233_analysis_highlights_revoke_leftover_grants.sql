-- Postgres grants TRUNCATE/REFERENCES/TRIGGER to the table owner's default
-- role set even after an explicit `revoke all` + narrower re-grant sequence
-- if the CREATE and REVOKE aren't in the same statement batch as the intended
-- final grant list -- authenticated ended up with TRUNCATE, which isn't
-- RLS-scoped (would let any authenticated user wipe every user's highlights,
-- not just their own). Caught by re-querying information_schema.table_privileges
-- after applying, not by trusting the SQL text (per CLAUDE.md's ADR 018/
-- migration-verification discipline).
revoke truncate, references, trigger on public.analysis_highlights from authenticated;
