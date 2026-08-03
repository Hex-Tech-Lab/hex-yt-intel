/**
 * entity-time-seek.ts
 *
 * Pure helper for the entity-click "seek video to timestamp" feature
 * (DashboardContainer's `handleSelectNode`). Extracted so the match-ranking
 * logic is unit-testable without mounting the container component.
 */

const TIMESTAMP_RE = /\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/;

export interface EntityTimeSeekNode {
  label?: string | null;
  content?: string | null;
  keyTerms?: string[] | null;
}

/**
 * Find the timestamp string most relevant to a given entity node.
 *
 * Prefers a match within the node's own `label` — the most specific signal
 * for "this entity" — before falling back to `content`, then `keyTerms`.
 * Previously all three fields were concatenated into one string and searched
 * with a single regex, so whichever field happened to appear first in the
 * concatenation order won regardless of relevance (e.g. an unrelated
 * timestamp buried in `content` could out-rank one actually in the label).
 */
export function findEntityTimestamp(node: EntityTimeSeekNode): string | null {
  const labelMatch = (node.label ?? '').match(TIMESTAMP_RE);
  if (labelMatch) return labelMatch[0];

  const contentMatch = (node.content ?? '').match(TIMESTAMP_RE);
  if (contentMatch) return contentMatch[0];

  const keyTermsMatch = (node.keyTerms ?? []).join(' ').match(TIMESTAMP_RE);
  if (keyTermsMatch) return keyTermsMatch[0];

  return null;
}
