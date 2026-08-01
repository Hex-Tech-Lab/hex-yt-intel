import type { ChatConversation } from '@/lib/types/chat';

/**
 * A re-analysis writes a NEW analyses row whose videoId carries this suffix
 * for the superseded version (see CreateAnalysisUseCase) -- centralized here
 * so every consumer of the archived-videoId convention strips it identically
 * instead of each hand-rolling the same regex.
 */
const ARCHIVED_VIDEO_ID_SUFFIX = /_archived_.*$/;

function stripArchivedSuffix(videoId: string | null | undefined): string | undefined {
  return videoId?.replace(ARCHIVED_VIDEO_ID_SUFFIX, '');
}

/**
 * Single source of truth for "does this video/analysis already have a chat
 * conversation" -- used everywhere a video/analysis restore needs to ground
 * or leave the chat panel (ChatDock's mount effect, AnalysisHistory's
 * History-click restore, useAutoRestoreAnalysis's URL-driven restore). All
 * callers MUST go through this helper rather than hand-rolling an ad hoc
 * match -- see the incident below.
 *
 * Matches in priority order, not "first array item that satisfies any
 * condition": exact analysisId, then exact videoId, then the
 * archived-suffix-stripped videoId. A single OR'd `.find()` would let
 * whichever conversation happens to sit earlier in the array win even if a
 * LATER item is the more specific (exact analysisId) match -- e.g. a user
 * with multiple conversations against one video (before/after re-analysis)
 * could have an older, looser videoId-only match beat the correct
 * analysisId match and get incorrectly rebound to the current analysis
 * (cubic/Qodo review, PR #177).
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
  if (analysisId) {
    const byAnalysisId = conversations.find((c) => c.analysisId === analysisId);
    if (byAnalysisId) return byAnalysisId;
  }
  if (videoId) {
    const byVideoId = conversations.find((c) => c.videoId === videoId);
    if (byVideoId) return byVideoId;
  }
  const cleanVideoId = stripArchivedSuffix(videoId);
  if (cleanVideoId) {
    return conversations.find((c) => stripArchivedSuffix(c.videoId) === cleanVideoId);
  }
  return undefined;
}
