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
// YouTube video IDs are a fixed 11-char base64url string, so only strip when
// the suffix follows a real 11-char ID prefix -- an unanchored replace would
// truncate a (hypothetical but possible) real ID shaped like
// `_archived_<1 char>` down to '', corrupting it instead of leaving it
// untouched (cubic review, PR #177).
const ARCHIVED_SUFFIX_RE = /^([A-Za-z0-9_-]{11})_archived_.*$/;

export function stripArchivedVideoIdSuffix(videoId: string | null | undefined): string | undefined {
  if (!videoId) return undefined;
  const match = videoId.match(ARCHIVED_SUFFIX_RE);
  return match ? match[1] : videoId;
}
