/**
 * entity-time-seek.ts
 *
 * Pure helper for the entity-click "seek video to timestamp" feature
 * (DashboardContainer's `handleSelectNode`). Extracted so the match-ranking
 * logic is unit-testable without mounting the container component.
 *
 * KG nodes don't carry a native timestamp field — they're semantic entities
 * (people, concepts, tools) extracted by the LLM, not time-indexed events.
 * Timestamps DO exist in the dimension content (LLM prose includes inline
 * markers like [12:34] that TimestampLink already renders). This function
 * falls back to searching the dimension content for the entity's label when
 * the node's own fields don't contain a timestamp.
 *
 * Supports both single timestamps (MM:SS, HH:MM:SS) and range formats
 * ("60:00–65:00", "60:00-65:00", "60:00 to 65:00") — extracts the start
 * time from any range.
 */
import { TfIdfSimilarityEngine } from '@/lib/intelligence/similarity';

const TIMESTAMP_RE = /\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/;
const TIMESTAMP_RE_GLOBAL = /\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/g;
// Range separator: en-dash, hyphen, or "to" (case-insensitive, word-bounded).
// Must be an alternation (?:–|-|to), not a [...] character class -- a class
// treats "to" as the two individual characters 't'/'o', not the literal
// word, silently breaking the "60:00 to 65:00" case despite looking correct.
const TIMESTAMP_RANGE_RE = /\b(?:\d{1,2}:)?\d{1,2}:\d{2}\s*(?:–|-|to)\s*(?:\d{1,2}:)?\d{1,2}:\d{2}\b/gi;

/** Parse "HH:MM:SS", "MM:SS", or "M:SS" to seconds. NaN on no match. */
function timeToSeconds(ts: string): number {
  const match = ts.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
  if (!match) return NaN;
  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const minutes = parseInt(match[2]!, 10);
  const seconds = parseInt(match[3]!, 10);
  return hours * 3600 + minutes * 60 + seconds;
}

/** Format seconds back to the "MM:SS" / "HH:MM:SS" display form. */
export function formatTimestamp(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export interface EntityTimeSeekNode {
  label?: string | null;
  content?: string | null;
  keyTerms?: string[] | null;
}

/** Chapter boundary, matching the transcript_chapters table shape. */
export interface EntityTimeSeekChapter {
  start_seconds: number;
  end_seconds: number;
  label?: string | null;
}

/** Per-mention match — used by findAllEntityMentions and findNearestEntityMention. */
export interface EntityMentionMatch {
  timestamp: string;
  seekSeconds: number;
  occurrenceIndex: number;
  /** Character offset of this occurrence's label match in dimensionContent, when resolved from prose (not a direct-field match). */
  offset?: number;
}

/**
 * Find the nearest preceding timestamp (or range start) before a given
 * position in text. Shared helper used by both findEntityTimestamp (single
 * occurrence) and findAllEntityMentions (all occurrences).
 */
function findPrecedingTimestamp(text: string): string | null {
  const rangeMatches = [...text.matchAll(TIMESTAMP_RANGE_RE)];
  const lastRange = rangeMatches[rangeMatches.length - 1];
  if (lastRange) {
    const afterRange = text.slice(lastRange.index! + lastRange[0].length);
    if (afterRange.trim() === '') {
      const startTime = lastRange[0].match(TIMESTAMP_RE);
      if (startTime) return startTime[0];
    }
  }
  const timestamps = [...text.matchAll(TIMESTAMP_RE_GLOBAL)];
  if (timestamps.length > 0) {
    return timestamps[timestamps.length - 1]![0];
  }
  return null;
}

/**
 * Find the timestamp string most relevant to a given entity node.
 *
 * Searches in priority order:
 * 1. Node's own `label` field (most specific signal)
 * 2. Node's own `content` field
 * 3. Node's own `keyTerms` array
 * 4. Dimension content (fallback — KG nodes are semantic entities, not
 *    time-indexed events, but the dimension's prose contains inline
 *    timestamps that correlate to when the entity was discussed)
 *
 * The dimension-content fallback uses the entity's label as a proximity
 * anchor: it finds the label in the dimension text, then returns the
 * nearest timestamp before it. If no label match is found, returns the
 * first timestamp in the dimension content.
 *
 * When chapters are provided, the entity-relevant timestamp (from any of
 * the above steps) is then checked against chapter boundaries. If it falls
 * inside a chapter's [start_seconds, end_seconds] range, the chapter's
 * start is returned instead of the raw timestamp — real chapter boundaries
 * are more reliable anchors than regex guesses. When no chapter data exists
 * (most already-analyzed videos), this behaves exactly as before.
 */
/**
 * If `chapters` covers the candidate timestamp, snap it to that chapter's
 * start (a real chapter boundary is a more reliable anchor than a raw
 * regex-extracted timestamp). On a tie at a shared boundary (candidate ===
 * some chapter's end === the next chapter's start), prefer the chapter with
 * the greater start_seconds -- the newly-started chapter, not the ending
 * one, since chapter ranges are filled contiguous ([start, next.start]) by
 * the parser and an exact-boundary timestamp reads as "the next chapter
 * just began," not "the previous one is still ending."
 */
function applyChapterBoundary(candidateStr: string, chapters?: EntityTimeSeekChapter[] | null): string {
  if (!chapters || chapters.length === 0) return candidateStr;
  const candidateSeconds = timeToSeconds(candidateStr);
  if (Number.isNaN(candidateSeconds)) return candidateStr;
  const chapter = chapters.reduce<EntityTimeSeekChapter | null>((best, ch) => {
    const inRange = candidateSeconds >= ch.start_seconds && candidateSeconds <= ch.end_seconds;
    if (!inRange) return best;
    if (!best || ch.start_seconds > best.start_seconds) return ch;
    return best;
  }, null);
  return chapter ? formatTimestamp(chapter.start_seconds) : candidateStr;
}

/**
 * Find all entity mentions in dimension content — returns every occurrence
 * of the entity's label in the dimension prose, each resolved to its own
 * timestamp via the same nearest-preceding-timestamp logic (including
 * range-format handling and chapter-boundary snapping).
 *
 * For node.label/node.content/node.keyTerms direct-field timestamp matches
 * (which are single authoritative values, not prose with multiple
 * occurrences), returns a single-element array. Returns empty array when
 * no timestamp can be resolved at all.
 */
export function findAllEntityMentions(
  node: EntityTimeSeekNode,
  dimensionContent?: string | null,
  chapters?: EntityTimeSeekChapter[] | null,
): EntityMentionMatch[] {
  // Direct field matches (single authoritative value, not prose)
  const labelMatch = (node.label ?? '').match(TIMESTAMP_RE);
  if (labelMatch) {
    const ts = applyChapterBoundary(labelMatch[0], chapters);
    return [{ timestamp: ts, seekSeconds: timeToSeconds(ts), occurrenceIndex: 0 }];
  }

  const contentMatch = (node.content ?? '').match(TIMESTAMP_RE);
  if (contentMatch) {
    const ts = applyChapterBoundary(contentMatch[0], chapters);
    return [{ timestamp: ts, seekSeconds: timeToSeconds(ts), occurrenceIndex: 0 }];
  }

  const keyTermsMatch = (node.keyTerms ?? []).join(' ').match(TIMESTAMP_RE);
  if (keyTermsMatch) {
    const ts = applyChapterBoundary(keyTermsMatch[0], chapters);
    return [{ timestamp: ts, seekSeconds: timeToSeconds(ts), occurrenceIndex: 0 }];
  }

  if (!dimensionContent) return [];

  const label = node.label;
  if (label) {
    const mentions: EntityMentionMatch[] = [];
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const labelRe = new RegExp(escapedLabel, 'g');

    // occurrenceIndex must reflect the label's position in the SOURCE TEXT
    // (every textual occurrence), not the position in the resolved-mentions
    // array -- an earlier occurrence with no resolvable preceding timestamp
    // is skipped (not pushed), so counting off `mentions.length` would
    // mislabel the next resolved occurrence as index 0 instead of its real
    // index (post-review finding, 2026-08-06).
    const labelMatches = dimensionContent.matchAll(labelRe);
    let textOccurrenceIndex = 0;
    for (const labelMatchResult of labelMatches) {
      const beforeLabel = dimensionContent.slice(0, labelMatchResult.index);
      const candidateStr = findPrecedingTimestamp(beforeLabel);
      if (candidateStr) {
        const ts = applyChapterBoundary(candidateStr, chapters);
        mentions.push({
          timestamp: ts,
          seekSeconds: timeToSeconds(ts),
          occurrenceIndex: textOccurrenceIndex,
          offset: labelMatchResult.index,
        });
      }
      textOccurrenceIndex++;
    }

    if (mentions.length > 0) return mentions;
  }

  // No label match found — fall back to first timestamp in dimension content
  const singleMatch = dimensionContent.match(TIMESTAMP_RE);
  if (singleMatch) {
    const ts = applyChapterBoundary(singleMatch[0], chapters);
    return [{ timestamp: ts, seekSeconds: timeToSeconds(ts), occurrenceIndex: 0 }];
  }

  const rangeMatch = dimensionContent.match(TIMESTAMP_RANGE_RE);
  const rangeText = rangeMatch?.[0];
  if (rangeText) {
    const startTime = rangeText.match(TIMESTAMP_RE);
    if (startTime) {
      const ts = applyChapterBoundary(startTime[0], chapters);
      return [{ timestamp: ts, seekSeconds: timeToSeconds(ts), occurrenceIndex: 0 }];
    }
  }

  return [];
}

/**
 * Pick whichever mention in a non-empty list is "best" relative to the
 * video's current playback position. Shared by findNearestEntityMention
 * (single-dimension) and findNearestEntityMentionAcrossDimensions
 * (entity-time-seek-cross-dimension.ts) -- both previously carried an
 * identical copy of this reduce (review-duplication finding, 2026-08-08
 * post-merge audit of PR #222); extracted here so a future edit to the
 * ranking policy can't land in one copy and not the other.
 *
 * When currentPlaybackSeconds is null (nothing has played yet), returns the
 * mention with the LATEST seekSeconds — the earliest occurrence is
 * typically a passing introduction near the start of the dimension
 * content, so every entity click before the first play would otherwise
 * resolve to the same early timestamp ("they almost all go to the same
 * spot, near 0:00", live report 2026-08-07). The most-recent-discussion
 * mention is a more useful default.
 *
 * Explicitly reduces by seekSeconds rather than trusting
 * `mentions[mentions.length - 1]` -- findAllEntityMentions pushes mentions
 * in left-to-right TEXT order, which usually but is not guaranteed to
 * correlate with chronological/seekSeconds order (nothing enforces the
 * source prose stays strictly chronological). Cubic review, PR #213,
 * caught post-merge.
 */
export function pickNearestMention(
  mentions: EntityMentionMatch[],
  currentPlaybackSeconds: number | null | undefined,
): EntityMentionMatch | null {
  if (mentions.length === 0) return null;
  if (currentPlaybackSeconds === null || currentPlaybackSeconds === undefined) {
    return mentions.reduce((latest, mention) => (mention.seekSeconds > latest.seekSeconds ? mention : latest));
  }
  return mentions.reduce((best, mention) => {
    const dist = Math.abs(mention.seekSeconds - currentPlaybackSeconds);
    const bestDist = Math.abs(best.seekSeconds - currentPlaybackSeconds);
    return dist < bestDist ? mention : best;
  });
}

export function findNearestEntityMention(
  node: EntityTimeSeekNode,
  dimensionContent: string | null | undefined,
  chapters: EntityTimeSeekChapter[] | null | undefined,
  currentPlaybackSeconds: number | null,
): EntityMentionMatch | null {
  const mentions = findAllEntityMentions(node, dimensionContent, chapters);
  return pickNearestMention(mentions, currentPlaybackSeconds);
}

export function findEntityTimestamp(
  node: EntityTimeSeekNode,
  dimensionContent?: string | null,
  chapters?: EntityTimeSeekChapter[] | null,
): string | null {
  const mentions = findAllEntityMentions(node, dimensionContent, chapters);
  return mentions[0]?.timestamp ?? null;
}

export interface RankedEntityMention {
  timestamp: string; // "MM:SS" or "HH:MM:SS", display form
  seekSeconds: number; // parsed start time in seconds
  occurrenceIndex: number;
  segmentEndSeconds: number; // where auto-play should stop and advance
  significance: number; // 0-100, higher = more significant
  dimensionNumber: number;
}

export interface EntityMentionIndex {
  nodeId: string; // matches GraphNode.id
  mentions: RankedEntityMention[]; // sorted by significance descending
}

// --- Significance scoring & segment heuristics (ADR 025) ---
// Reconciled from two parallel implementations (AGY's UI-consuming
// placeholder on PR #224, OC's real TF-IDF+density scorer on PR #225) --
// this is the merged, bug-fixed version both PRs converge on.
const SIGNIFICANCE_TFIDF_WEIGHT = 0.55;
const SIGNIFICANCE_DENSITY_WEIGHT = 0.30;
const SIGNIFICANCE_POSITION_WEIGHT = 0.15;
const SIGNIFICANCE_CEILING = 100;
const SEGMENT_DEFAULT_SECONDS = 30;
const SEGMENT_MAX_SECONDS = 45;
const TFIDF_CONTEXT_WINDOW = 80;
const TFIDF_CONTEXT_AFTER = 150;
// /simplify's density-score slice window: computeDensityScore only needs a
// bounded lookahead (5 sentences, checked via early break) -- slicing all
// the way to the end of a long dimension (thousands of chars) for that was
// pure waste. ~2000 chars comfortably covers 5 real sentences.
const DENSITY_LOOKAHEAD_CHARS = 2000;

// Singleton TF-IDF engine reused across all mention-scoring calls. The
// existing TfIdfSimilarityEngine (from knowledge-graph.ts) tokenizes,
// computes IDF, and returns pairwise cosine similarity -- reused here by
// comparing each mention's context window against the full dimension text:
// LOW cosine similarity means the context is lexically distinctive
// (unusual/technical terms), interpreted as higher significance; HIGH
// similarity means typical prose, lower significance.
const tfidfEngine = new TfIdfSimilarityEngine();

function computeTfIdfScore(context: string, fullText: string): number {
  if (!context.trim() || !fullText.trim()) return 0;
  const result = tfidfEngine.compute([context, fullText]);
  const cos = result.matrix[0]?.[1] ?? 0;
  return Math.min(1, Math.max(0, 1 - cos));
}

function computeDensityScore(text: string, mentionOffset: number): number {
  const afterMention = text.slice(mentionOffset, mentionOffset + DENSITY_LOOKAHEAD_CHARS);
  let sentenceCount = 0;
  const sentences = afterMention.split(/[.!?]+\s*/);
  for (const sentenceItem of sentences) {
    if (!sentenceItem.trim()) continue;
    sentenceCount++;
    if (sentenceCount > 5) { break; }
    const hasTimestamp = TIMESTAMP_RE.test(sentenceItem);
    if (hasTimestamp && sentenceCount >= 2) { break; }
  }
  return Math.min(1, sentenceCount / 5);
}

function computePositionScore(idx: number, total: number): number {
  if (total <= 1) return 1;
  return (idx + 1) / total;
}

function deriveSegmentEnd(
  seekSeconds: number,
  nextSeekSeconds: number | null,
  chapters: EntityTimeSeekChapter[] | null | undefined,
  videoDuration: number | null,
): number {
  // The tightest real upper bound this segment must never cross, no matter
  // what the rest of this function computes -- either the video's own end,
  // or the next mention's start, whichever is closer. CodeRabbit review,
  // PR #224 (2026-08-08 pass): the earlier fix for the "5s minimum window"
  // bug (see below) applied its replacement 0.5s floor AFTER this bound was
  // computed but didn't clamp the floor itself against it -- a mention with
  // LESS than 0.5s of real room left (video ends there, or the next mention
  // is that close) could still get pushed past the bound by the floor.
  // Clamping the floor's own candidate value against upperBound closes that
  // gap for good, rather than shrinking the floor to some other small
  // constant that would just move the same class of bug to a different
  // threshold.
  const upperBound = Math.min(
    videoDuration !== null && videoDuration > 0 ? videoDuration : Infinity,
    nextSeekSeconds !== null && nextSeekSeconds > seekSeconds ? nextSeekSeconds : Infinity,
  );

  let end = seekSeconds + SEGMENT_DEFAULT_SECONDS;

  if (chapters && chapters.length > 0) {
    // /simplify finding: a separate CHAPTER_CAP_SECONDS (60) here was dead
    // code -- the SEGMENT_MAX_SECONDS clamp below always tightened further
    // since SEGMENT_MAX_SECONDS (45) < 60, so it never had a chance to bind.
    const chapterItem = chapters.find((ch) => seekSeconds >= ch.start_seconds && seekSeconds <= ch.end_seconds);
    if (chapterItem && chapterItem.end_seconds > seekSeconds) {
      end = chapterItem.end_seconds;
    }
  }

  end = Math.min(end, upperBound, seekSeconds + SEGMENT_MAX_SECONDS);

  // Cubic review, PR #224 AND PR #225 (same bug in both independent
  // implementations): a 5s MINIMUM window forced via Math.max AFTER every
  // upper-bound clamp above (chapter end / next mention / video duration)
  // could push the result back PAST those bounds -- a mention within the
  // video's final 5s, or two mentions <5s apart, produced a segment end
  // past the video's own duration or into the next mention's territory.
  // A short segment (even under 0.5s) is correct when that's genuinely all
  // the room there is; the floor candidate itself is now clamped to
  // upperBound so it can never re-violate the bound it exists to guard
  // against a degenerate zero/negative window from.
  return Math.max(end, Math.min(seekSeconds + 0.5, upperBound));
}

/**
 * Get all mentions for an entity node ranked by significance (ADR 025 contract).
 * Uses a hybrid TF-IDF + local discussion density + position heuristic to
 * score each mention's significance 0-100, then sorts descending by score.
 */
export function getRankedMentionsForEntity(
  nodeId: string,
  node: EntityTimeSeekNode & { dimension?: number },
  dimensionContent?: string | null,
  chapters?: EntityTimeSeekChapter[] | null,
  videoDuration?: number | null,
): EntityMentionIndex {
  const matches = findAllEntityMentions(node, dimensionContent, chapters);
  const dimensionNumber = typeof node.dimension === 'number' && node.dimension > 0 ? node.dimension : 1;

  if (matches.length === 0) {
    return { nodeId, mentions: [] };
  }

  // Cubic review, PR #225 (fully resolved this pass): the original
  // implementation built a plain ARRAY of every textual label-regex match's
  // offset, then indexed it by `idx` into `matches` -- but
  // findAllEntityMentions SKIPS a textual occurrence when no preceding
  // timestamp can be resolved for it, while still incrementing its
  // internal textOccurrenceIndex for every occurrence, skipped or not. That
  // means `matches[idx].occurrenceIndex` is NOT guaranteed to equal `idx`
  // once any earlier occurrence was skipped, silently misaligning which
  // text offset got attributed to which resolved mention. A prior pass on
  // this file already made findAllEntityMentions carry `offset` directly on
  // each EntityMentionMatch it returns (same fix as this comment used to
  // describe, applied at the source instead of re-derived here) -- reading
  // `matchItem.offset` below reuses that instead of re-scanning
  // dimensionContent with the same label regex a second time.
  const fullText = dimensionContent || '';

  // Cubic review, PR #224 (issue ab9d49eb): `deriveSegmentEnd`'s "next
  // mention" boundary must be the next mention CHRONOLOGICALLY
  // (by seekSeconds), not the next one in `matches`' TEXT-occurrence order
  // -- LLM-narrated dimension prose can refer back to an earlier timestamp
  // mid-paragraph, so text order and chronological order aren't guaranteed
  // to match. Precompute a seekSeconds-sorted view once and look up each
  // mention's chronological successor by its seekSeconds, not by `idx + 1`.
  const chronological = [...matches].sort((matchA, matchB) => matchA.seekSeconds - matchB.seekSeconds);
  const nextSeekSecondsByMatch = new Map<EntityMentionMatch, number | null>();
  chronological.forEach((matchItem, chronoIdx) => {
    nextSeekSecondsByMatch.set(matchItem, chronoIdx + 1 < chronological.length ? chronological[chronoIdx + 1]!.seekSeconds : null);
  });

  const mentions: RankedEntityMention[] = matches.map((matchItem, idx) => {
    const segmentEndSeconds = deriveSegmentEnd(
      matchItem.seekSeconds,
      nextSeekSecondsByMatch.get(matchItem) ?? null,
      chapters,
      videoDuration ?? null,
    );

    const offset = matchItem.offset;
    const contextStart = Math.max(0, (offset ?? 0) - TFIDF_CONTEXT_WINDOW);
    const contextEnd = Math.min(fullText.length, (offset ?? 0) + TFIDF_CONTEXT_AFTER);
    const context = fullText.slice(contextStart, contextEnd);

    const tfidfScore = computeTfIdfScore(context, fullText);
    const densityScore = offset !== undefined ? computeDensityScore(fullText, offset) : 0.5;
    const positionScore = computePositionScore(idx, matches.length);

    const significance = Math.round(
      (tfidfScore * SIGNIFICANCE_TFIDF_WEIGHT +
       densityScore * SIGNIFICANCE_DENSITY_WEIGHT +
       positionScore * SIGNIFICANCE_POSITION_WEIGHT) *
      SIGNIFICANCE_CEILING
    );

    return {
      timestamp: matchItem.timestamp,
      seekSeconds: matchItem.seekSeconds,
      occurrenceIndex: matchItem.occurrenceIndex,
      segmentEndSeconds,
      significance: Math.max(1, Math.min(SIGNIFICANCE_CEILING, significance)),
      dimensionNumber,
    };
  });

  // Tie-break equal significance scores chronologically (earlier mention
  // first) so ranking order is deterministic rather than left to whatever
  // order `matches` happened to be in -- V8's sort is stable, but the sort
  // key itself previously had no tiebreaker, so two equal-significance
  // mentions could appear in either order depending on unrelated upstream
  // iteration order.
  mentions.sort((firstMention, secondMention) =>
    secondMention.significance - firstMention.significance || firstMention.seekSeconds - secondMention.seekSeconds,
  );

  return { nodeId, mentions };
}

// findNearestEntityMentionAcrossDimensions moved to
// entity-time-seek-cross-dimension.ts (2026-08-08) to keep this file under
// qa-intel's 500-line ComplexityRule threshold.
