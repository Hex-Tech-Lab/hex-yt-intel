/**
 * Cross-dimension entity mention search. Split out of entity-time-seek.ts
 * (2026-08-08) purely to keep that file under qa-intel's 500-line
 * ComplexityRule threshold after PR #222 and PR #224 landed on top of each
 * other -- no behavior change, same function, same tests, new home.
 */
import { findAllEntityMentions, pickNearestMention } from './entity-time-seek';
import type { EntityTimeSeekNode, EntityTimeSeekChapter, EntityMentionMatch } from './entity-time-seek';

/**
 * Cross-dimension nearest-mention search (Cubic review, PR #222).
 *
 * The single-dimension `findAllEntityMentions` deliberately degrades to
 * "first timestamp in the content" when the entity's label isn't literally
 * found in that dimension's prose (see its own doc comment) -- a reasonable
 * last resort for the ONE dimension a node is nominally assigned to, but a
 * false-positive generator when applied across every OTHER dimension: it
 * would report a "mention" for practically any dimension that contains any
 * timestamp at all, regardless of whether the entity was ever discussed
 * there, and the first dimension scanned would silently win over a genuinely
 * closer mention in a later one.
 *
 * This variant requires the label to literally appear in a candidate
 * dimension's content before accepting any of its mentions, and ranks ALL
 * accepted mentions from ALL candidate dimensions together with the same
 * nearest-to-playhead (or latest, if nothing has played yet) policy
 * `findNearestEntityMention` already uses for a single dimension --  so
 * "search more dimensions" only adds real candidates, never degrades match
 * quality within a single dimension.
 */
export function findNearestEntityMentionAcrossDimensions(
  node: EntityTimeSeekNode,
  dimensionContents: Array<{ dimensionNumber: number; content: string }>,
  chapters: EntityTimeSeekChapter[] | null | undefined,
  currentPlaybackSeconds: number | null,
): EntityMentionMatch | null {
  const label = node.label;
  // CodeRabbit review, 2026-08-08: `label && !content.includes(label)`
  // only skips a dimension when label IS present but not found in it. When
  // label is missing/blank, the check short-circuits false and skips
  // NOTHING -- every dimension gets included, and findAllEntityMentions'
  // own degraded "first timestamp in content" fallback then fires for
  // each one, reproducing the exact false-positive-per-dimension problem
  // this function exists to prevent (see its own doc comment above). A
  // node with no usable label can't be verified against any dimension's
  // content, so it has no business searching across dimensions at all.
  if (!label || !label.trim()) return null;
  const allMentions: EntityMentionMatch[] = [];
  for (const { content } of dimensionContents) {
    if (!content.includes(label)) continue;
    allMentions.push(...findAllEntityMentions(node, content, chapters));
  }
  return pickNearestMention(allMentions, currentPlaybackSeconds);
}
