/**
 * The reaper (dimension-remediation / re-analysis flow) appends this suffix
 * to a superseded analysis's `video_id` when a video is re-analyzed (see
 * `regexp_replace(video_id, '_archived_.*$', '')` in the history-overview
 * SQL function). Single source of truth for stripping it -- this exact
 * regex was independently hand-duplicated across at least three call sites
 * (web/app/api/analyses/[id]/route.ts, SupabaseAnalysisAdapter.ts,
 * find-chat-conversation.ts) before being consolidated here 2026-08-01,
 * the same "duplicated convention drifts out of sync" failure mode this
 * session's chat-restore bug came from. Do not re-duplicate; import this.
 */
// Matches the SQL SSOT unconditionally, same as `regexp_replace(video_id,
// '_archived_.*$', '')` -- the reaper's own write side
// (`SET video_id = video_id || '_archived_' || extract(epoch...)`,
// 20260612120000_atomic_compare_and_reserve.sql) appends this suffix to
// WHATEVER video_id currently is, with no length/format check, so the read
// side must strip it the same unconditional way to stay in lockstep.
//
// An earlier version of this regex was anchored to require an 11-char
// YouTube-ID prefix before `_archived_` (PR #177, defending against a
// theoretical real ID shaped like `_archived_<1 char>` being corrupted by
// an unanchored strip). That deviated from the actual SQL contract and
// reintroduced the opposite, more likely failure: any video_id that isn't
// exactly 11 chars would silently NOT get its archived suffix stripped,
// leaking `_archived_...` into player/transcript/chat-matching paths that
// expect a canonical id (cubic review, PR #177 re-audit). Mirroring SQL
// exactly is the same principle aux-status-from-report.ts documents for
// its own SSOT.
const ARCHIVED_SUFFIX_RE = /_archived_.*$/;

export function stripArchivedVideoIdSuffix(videoId: string | null | undefined): string | undefined {
  if (!videoId) return undefined;
  return videoId.replace(ARCHIVED_SUFFIX_RE, '');
}
