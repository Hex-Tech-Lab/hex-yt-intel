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
 */

const TIMESTAMP_RE = /\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/;
// matchAll() requires a global-flagged regex or it throws TypeError — a
// separate instance since the single-match .match() calls above want the
// non-global form (matchAll on a non-global regex is a runtime error, not
// just "returns one match").
const TIMESTAMP_RE_GLOBAL = /\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/g;

export interface EntityTimeSeekNode {
  label?: string | null;
  content?: string | null;
  keyTerms?: string[] | null;
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
 */
export function findEntityTimestamp(
  node: EntityTimeSeekNode,
  dimensionContent?: string | null,
): string | null {
  const labelMatch = (node.label ?? '').match(TIMESTAMP_RE);
  if (labelMatch) return labelMatch[0];

  const contentMatch = (node.content ?? '').match(TIMESTAMP_RE);
  if (contentMatch) return contentMatch[0];

  const keyTermsMatch = (node.keyTerms ?? []).join(' ').match(TIMESTAMP_RE);
  if (keyTermsMatch) return keyTermsMatch[0];

  if (dimensionContent) {
    const label = node.label;
    if (label) {
      const labelIdx = dimensionContent.indexOf(label);
      if (labelIdx >= 0) {
        const beforeLabel = dimensionContent.slice(0, labelIdx);
        const timestamps = [...beforeLabel.matchAll(TIMESTAMP_RE_GLOBAL)];
        if (timestamps.length > 0) {
          return timestamps[timestamps.length - 1]![0];
        }
      }
    }
    const fallbackMatch = dimensionContent.match(TIMESTAMP_RE);
    if (fallbackMatch) return fallbackMatch[0];
  }

  return null;
}
