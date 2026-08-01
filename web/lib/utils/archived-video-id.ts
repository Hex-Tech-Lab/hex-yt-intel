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
export function stripArchivedVideoIdSuffix(videoId: string | null | undefined): string | undefined {
  if (!videoId) return undefined;
  return videoId.replace(/_archived_.*$/, '');
}
