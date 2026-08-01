import type { ChatConversation } from '@/lib/types/chat';

/**
 * Single source of truth for "does this video/analysis already have a chat
 * conversation" -- used everywhere a video/analysis restore needs to ground
 * or leave the chat panel (ChatDock's mount effect, AnalysisHistory's
 * History-click restore, useAutoRestoreAnalysis's URL-driven restore).
 *
 * Strips the `_archived_...` suffix a re-analyzed video's videoId can carry
 * before comparing -- a re-analysis writes a NEW analyses row with an
 * archived-suffixed videoId for the superseded version, so a naive
 * `c.videoId === videoId` match fails for it even though the conversation
 * is really the same one.
 *
 * Real bug, live-reported 2026-08-01: this same match logic was
 * independently duplicated in three call sites, and only two of the three
 * got the archived-suffix fix when it was first found -- the third
 * (useAutoRestoreAnalysis.ts, the hook that drives restoration on page
 * load/hard refresh) kept silently failing to match on exactly the videos
 * a user was refreshing to re-check. One shared implementation now; do not
 * re-duplicate this match logic at a new call site.
 */
export function findMatchingConversation(
  conversations: ChatConversation[],
  analysisId: string | null | undefined,
  videoId: string | null | undefined
): ChatConversation | undefined {
  const cleanVideoId = videoId?.replace(/_archived_.*$/, '');
  return conversations.find((c) => {
    const itemCleanVideoId = c.videoId?.replace(/_archived_.*$/, '');
    return (
      (!!analysisId && c.analysisId === analysisId) ||
      (!!videoId && c.videoId === videoId) ||
      (!!cleanVideoId && itemCleanVideoId === cleanVideoId)
    );
  });
}
