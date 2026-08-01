import type { ChatConversation } from '@/lib/types/chat';
import { stripArchivedVideoIdSuffix } from '@/lib/utils/archived-video-id';

/**
 * Single match-tier primitive both findMatchingConversation (pick the
 * highest-tier winner) and filterConversationsForContext (keep anything
 * above tier 0) are built from -- altitude review, PR #177: an earlier
 * version of this file hand-rolled the match condition twice (once inline
 * in each function), which is exactly the "independently duplicated match
 * logic" failure mode this file exists to eliminate. One tier function now;
 * do not re-implement the match condition a second time in this file.
 *
 * 3 = exact analysisId, 2 = exact videoId, 1 = archived-suffix-stripped
 * videoId match, 0 = no match.
 */
function matchTier(
  c: ChatConversation,
  analysisId: string | null | undefined,
  videoId: string | null | undefined,
  cleanVideoId: string | undefined
): 0 | 1 | 2 | 3 {
  if (analysisId && c.analysisId === analysisId) return 3;
  if (videoId && c.videoId === videoId) return 2;
  if (cleanVideoId && stripArchivedVideoIdSuffix(c.videoId) === cleanVideoId) return 1;
  return 0;
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
  const cleanVideoId = stripArchivedVideoIdSuffix(videoId);
  let best: ChatConversation | undefined;
  let bestTier = 0;
  for (const c of conversations) {
    const tier = matchTier(c, analysisId, videoId, cleanVideoId);
    if (tier > bestTier) {
      best = c;
      bestTier = tier;
      if (bestTier === 3) break; // can't beat the top tier
    }
  }
  return best;
}

/**
 * ALL conversations grounded in this analysis/video (across re-analyses),
 * for the thread-switcher dropdown -- NOT the single best match
 * findMatchingConversation returns (priority order doesn't apply here,
 * every match is wanted). Real bug, live-reported 2026-08-01 (screenshot):
 * the thread switcher rendered the user's ENTIRE global conversation list
 * with zero filtering, so a completely unrelated video's conversation
 * (e.g. a fitness-topic thread) appeared in the list while viewing a
 * political-news video -- looked like disorganized "individual turns"
 * instead of a clean per-video session list.
 *
 * No context (both analysisId and videoId null/undefined) means "general
 * chat", not "nothing" -- returns every conversation unfiltered. Filtering
 * to nothing here made the thread switcher hide every existing
 * conversation, including general-chat threads, whenever no video/analysis
 * was active (cubic/Qodo review, PR #177).
 */
export function filterConversationsForContext(
  conversations: ChatConversation[],
  analysisId: string | null | undefined,
  videoId: string | null | undefined
): ChatConversation[] {
  if (!analysisId && !videoId) return conversations;
  const cleanVideoId = stripArchivedVideoIdSuffix(videoId);
  return conversations.filter((c) => matchTier(c, analysisId, videoId, cleanVideoId) > 0);
}
