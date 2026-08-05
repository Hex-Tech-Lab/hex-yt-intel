-- Defense-in-depth CHECK constraint for transcript_chapters (PR #205 review,
-- 2026-08-05, item 3). Chapter persistence in web/app/api/analyses/persist/
-- route.ts is best-effort -- a write failure is caught/logged but doesn't
-- fail the overall analysis-persist request, so malformed data could
-- otherwise reach the table with no visible failure. The Zod schema at the
-- API boundary now rejects the same shapes; this constraint is the second
-- layer for any write path that doesn't go through that route (a future
-- script, a manual fix, a different caller).
--
-- Allows exactly two shapes:
--   1. A real chapter: idx >= 0, both timestamps finite and nonnegative,
--      end_seconds > start_seconds, label nonblank.
--   2. The exact sentinel row written by write_chapter_sentinel():
--      idx = -1, start_seconds = -1, end_seconds = -1,
--      label = '__attempted_empty__'.
alter table public.transcript_chapters
  add constraint transcript_chapters_valid_shape check (
    (
      idx >= 0
      and start_seconds >= 0
      and end_seconds > start_seconds
      and length(trim(label)) > 0
    )
    or (
      idx = -1
      and start_seconds = -1
      and end_seconds = -1
      and label = '__attempted_empty__'
    )
  );
