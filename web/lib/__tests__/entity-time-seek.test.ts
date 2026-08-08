/**
 * Entity time-seek ranking — the pure "which timestamp wins" logic behind
 * DashboardContainer's handleSelectNode entity-click seek.
 */
import { describe, it, expect } from 'vitest';
import { findEntityTimestamp, findAllEntityMentions, findNearestEntityMention, getRankedMentionsForEntity } from '@/lib/utils/entity-time-seek';

describe('findEntityTimestamp', () => {
  it('prefers a timestamp in the label over one in content', () => {
    const node = {
      label: 'Discussion at 5:30',
      content: 'Unrelated aside mentioning 12:10 happens earlier in the transcript',
      keyTerms: [],
    };
    expect(findEntityTimestamp(node)).toBe('5:30');
  });

  it('falls back to content when the label has no timestamp', () => {
    const node = {
      label: 'Pricing strategy',
      content: 'They cover this starting at 8:42 in detail',
      keyTerms: ['9:15'],
    };
    expect(findEntityTimestamp(node)).toBe('8:42');
  });

  it('falls back to keyTerms when neither label nor content has a timestamp', () => {
    const node = {
      label: 'Pricing strategy',
      content: 'No timing info here',
      keyTerms: ['budget', '3:20'],
    };
    expect(findEntityTimestamp(node)).toBe('3:20');
  });

  it('returns null when no field contains a timestamp', () => {
    const node = { label: 'Pricing strategy', content: 'No timing info', keyTerms: ['budget'] };
    expect(findEntityTimestamp(node)).toBeNull();
  });

  it('handles missing/undefined fields gracefully', () => {
    expect(findEntityTimestamp({})).toBeNull();
    expect(findEntityTimestamp({ label: undefined, content: null, keyTerms: undefined })).toBeNull();
  });

  it('falls back to dimension content when node fields have no timestamp, using the nearest preceding timestamp before the label', () => {
    const node = { label: 'Patrick Winston', content: 'No timing info', keyTerms: [] };
    const dimensionContent =
      'At 2:10 we cover intros. At 5:45 Patrick Winston explains the K-P-T formula. Later at 9:00 we move on.';
    expect(findEntityTimestamp(node, dimensionContent)).toBe('5:45');
  });

  it('falls back to the first timestamp in dimension content when the label is not found there', () => {
    const node = { label: 'Some entity not in the transcript', content: 'No timing info', keyTerms: [] };
    const dimensionContent = 'At 2:10 we cover intros. At 5:45 something else happens.';
    expect(findEntityTimestamp(node, dimensionContent)).toBe('2:10');
  });

  it('does not use the dimension-content fallback when the node itself already has a timestamp', () => {
    const node = { label: 'Discussion at 5:30', content: '', keyTerms: [] };
    const dimensionContent = 'At 2:10 something unrelated happens.';
    expect(findEntityTimestamp(node, dimensionContent)).toBe('5:30');
  });

  it('returns null when dimensionContent is provided but has no timestamps at all', () => {
    const node = { label: 'Pricing strategy', content: 'No timing info', keyTerms: [] };
    expect(findEntityTimestamp(node, 'Nothing time-related here.')).toBeNull();
  });

  it('uses a chapter boundary over regex when the content timestamp falls inside a chapter', () => {
    const node = { label: 'Pricing strategy', content: 'No timing info', keyTerms: [] };
    const dimensionContent = 'At 5:45 Pricing strategy is discussed in detail.';
    const chapters = [
      { start_seconds: 0, end_seconds: 60, label: 'Intro' },
      { start_seconds: 300, end_seconds: 420, label: 'Pricing deep dive' },
    ];
    expect(findEntityTimestamp(node, dimensionContent, chapters)).toBe('5:00');
  });

  it('falls through to regex when no chapter brackets the content timestamp', () => {
    const node = { label: 'Pricing strategy', content: 'No timing info', keyTerms: [] };
    const dimensionContent = 'At 5:45 Pricing strategy is discussed in detail.';
    const chapters = [
      { start_seconds: 600, end_seconds: 720, label: 'Late section' },
    ];
    expect(findEntityTimestamp(node, dimensionContent, chapters)).toBe('5:45');
  });

  it('behaves identically to before when no chapters are provided', () => {
    const node = { label: 'Pricing strategy', content: 'No timing info', keyTerms: [] };
    const dimensionContent = 'At 5:45 Pricing strategy is discussed.';
    expect(findEntityTimestamp(node, dimensionContent, null)).toBe('5:45');
    expect(findEntityTimestamp(node, dimensionContent, [])).toBe('5:45');
  });

  it('extracts the start time from a range-format timestamp in dimension content', () => {
    const node = { label: 'Apex', content: 'No timing info', keyTerms: [] };
    const dimensionContent = 'The Apex framework segment runs from 60:00 to 65:00.';
    expect(findEntityTimestamp(node, dimensionContent)).toBe('60:00');
  });

  it('uses the START of a range immediately preceding the label, not the range end (label-proximity branch)', () => {
    const node = { label: 'Entity A', content: 'No timing info', keyTerms: [] };
    const dimensionContent = 'Segment: 60:00 to 65:00 Entity A discussion follows.';
    expect(findEntityTimestamp(node, dimensionContent)).toBe('60:00');
  });

  it('uses label-proximity timestamp for chapter check, not the first timestamp (P0-4)', () => {
    // Two timestamps, only the second is near the entity label. The chapter
    // check must use the label-proximity timestamp (50:00), not the first one
    // (2:10). The chapter "Deep dive" (40:00-60:00) brackets 50:00, so the
    // result should be the chapter start (40:00), not the raw 50:00.
    const node = { label: 'Entity B', content: '', keyTerms: [] };
    const dimensionContent = 'At 2:10 we cover intros. At 50:00 Entity B is discussed in depth.';
    const chapters = [
      { start_seconds: 0, end_seconds: 300, label: 'Intro' },
      { start_seconds: 2400, end_seconds: 3600, label: 'Deep dive' },
    ];
    expect(findEntityTimestamp(node, dimensionContent, chapters)).toBe('40:00');
  });

  it('uses the label-proximity timestamp when it falls outside any chapter (P0-4)', () => {
    const node = { label: 'Entity B', content: '', keyTerms: [] };
    const dimensionContent = 'At 2:10 we cover intros. At 50:00 Entity B is discussed.';
    const chapters = [
      { start_seconds: 0, end_seconds: 300, label: 'Intro' },
    ];
    // 50:00 = 3000s, falls outside the 0-300s chapter, so return raw 50:00
    expect(findEntityTimestamp(node, dimensionContent, chapters)).toBe('50:00');
  });

  it('resolves an exact shared chapter boundary to the later chapter, not the earlier one', () => {
    const node = { label: 'Entity C', content: '', keyTerms: [] };
    const dimensionContent = 'At 5:00 Entity C is introduced.';
    // 5:00 = 300s sits exactly on the shared boundary between both chapters.
    const chapters = [
      { start_seconds: 0, end_seconds: 300, label: 'Intro' },
      { start_seconds: 300, end_seconds: 600, label: 'Deep dive' },
    ];
    expect(findEntityTimestamp(node, dimensionContent, chapters)).toBe('5:00');
  });

  it('applies chapter-boundary snapping to a literal timestamp in node.label, not just the dimension fallback', () => {
    const node = { label: '10:00 marker', content: '', keyTerms: [] };
    const chapters = [{ start_seconds: 0, end_seconds: 1200, label: 'Full chapter' }];
    // node.label itself contains a timestamp (rare, but must still snap to
    // the covering chapter's start -- this was bypassed before the fix.
    expect(findEntityTimestamp(node, null, chapters)).toBe('0:00');
  });
});

describe('findAllEntityMentions', () => {
  it('returns multiple mentions when the entity label appears multiple times', () => {
    const node = { label: 'Patrick Winston', content: '', keyTerms: [] };
    const content = 'At 2:10 Patrick Winston is introduced. At 5:45 Patrick Winston explains the K-P-T formula. At 9:00 Patrick Winston summarizes.';
    const mentions = findAllEntityMentions(node, content);
    expect(mentions.length).toBe(3);
    expect(mentions[0]!.timestamp).toBe('2:10');
    expect(mentions[0]!.occurrenceIndex).toBe(0);
    expect(mentions[1]!.timestamp).toBe('5:45');
    expect(mentions[1]!.occurrenceIndex).toBe(1);
    expect(mentions[2]!.timestamp).toBe('9:00');
    expect(mentions[2]!.occurrenceIndex).toBe(2);
  });

  it('returns single-element array for node.label direct timestamp match', () => {
    const node = { label: 'Discussion at 5:30', content: '', keyTerms: [] };
    const mentions = findAllEntityMentions(node);
    expect(mentions.length).toBe(1);
    expect(mentions[0]!.timestamp).toBe('5:30');
    expect(mentions[0]!.occurrenceIndex).toBe(0);
  });

  it('returns empty array for node with no timestamp and no dimension content', () => {
    const node = { label: 'Pricing strategy', content: '', keyTerms: [] };
    expect(findAllEntityMentions(node)).toEqual([]);
  });

  it('returns empty array when dimension content has no timestamps at all', () => {
    const node = { label: 'Pricing strategy', content: '', keyTerms: [] };
    expect(findAllEntityMentions(node, 'Nothing time-related here.')).toEqual([]);
  });

  it('applies chapter-boundary snapping per occurrence', () => {
    const node = { label: 'Entity B', content: '', keyTerms: [] };
    const content = 'At 2:10 we cover intros. At 50:00 Entity B is discussed in depth. At 55:00 Entity B is revisited.';
    const chapters = [
      { start_seconds: 0, end_seconds: 300, label: 'Intro' },
      { start_seconds: 2400, end_seconds: 3600, label: 'Deep dive' },
    ];
    const mentions = findAllEntityMentions(node, content, chapters);
    // 50:00 (= 3000s) falls in Deep dive chapter (2400-3600s) → snapped to 40:00
    // 55:00 (= 3300s) also falls in Deep dive chapter → snapped to 40:00
    expect(mentions.length).toBe(2);
    expect(mentions[0]!.timestamp).toBe('40:00');
    expect(mentions[1]!.timestamp).toBe('40:00');
  });

  it('handles range-format timestamps per occurrence', () => {
    const node = { label: 'Apex', content: '', keyTerms: [] };
    const content = 'Before 60:00 the Apex framework is mentioned. At 90:00 Apex is discussed again.';
    const mentions = findAllEntityMentions(node, content);
    expect(mentions.length).toBe(2);
    expect(mentions[0]!.timestamp).toBe('60:00');
    expect(mentions[1]!.timestamp).toBe('90:00');
  });

  it('occurrenceIndex reflects source-text position, not resolved-array position, when an earlier occurrence has no resolvable timestamp', () => {
    // Post-review finding (2026-08-06): occurrenceIndex used to be assigned
    // from mentions.length at push time -- an earlier textual occurrence
    // with no preceding timestamp is skipped (never pushed), so the NEXT
    // resolved occurrence was mislabeled as index 0 instead of its real
    // index 1. This is occurrence 0 (Apex mentioned with nothing before it)
    // -- unresolved, skipped -- then occurrence 1 (Apex at 45:00) -- resolved.
    const node = { label: 'Apex', content: '', keyTerms: [] };
    const content = 'Apex is mentioned here with no preceding timestamp. Later, at 45:00, Apex comes up again.';
    const mentions = findAllEntityMentions(node, content);
    expect(mentions.length).toBe(1);
    expect(mentions[0]!.timestamp).toBe('45:00');
    expect(mentions[0]!.occurrenceIndex).toBe(1);
  });
});

describe('findNearestEntityMention', () => {
  it('returns the mention nearest to currentPlaybackSeconds', () => {
    const node = { label: 'Patrick Winston', content: '', keyTerms: [] };
    const content = 'At 2:10 Patrick Winston is introduced. At 5:45 Patrick Winston explains the K-P-T formula. At 9:00 Patrick Winston summarizes.';
    // Playhead at 6:00 (360s) — nearest mention is 5:45 (345s)
    const mention = findNearestEntityMention(node, content, null, 360);
    expect(mention).not.toBeNull();
    expect(mention!.timestamp).toBe('5:45');
    expect(mention!.occurrenceIndex).toBe(1);
  });

  it('returns the last mention when currentPlaybackSeconds is null (not the first — avoids "always near 0:00")', () => {
    const node = { label: 'Patrick Winston', content: '', keyTerms: [] };
    const content = 'At 2:10 Patrick Winston is introduced. At 5:45 Patrick Winston explains the K-P-T formula.';
    const mention = findNearestEntityMention(node, content, null, null);
    expect(mention).not.toBeNull();
    // Should return the LAST occurrence (most recent mention), not the first.
    expect(mention!.timestamp).toBe('5:45');
    expect(mention!.occurrenceIndex).toBe(1);
  });

  it('returns the mention with the LATEST seekSeconds when null, even if it is not the last one in text order', () => {
    // Out-of-order prose: the LLM references the later moment first ("as they
    // later note at 9:00...") before circling back to an earlier one -- the
    // fallback must pick by actual seekSeconds, not by array/text position.
    const node = { label: 'Patrick Winston', content: '', keyTerms: [] };
    const content = 'At 9:00 Patrick Winston summarizes. Earlier, at 2:10, Patrick Winston is introduced.';
    const mention = findNearestEntityMention(node, content, null, null);
    expect(mention).not.toBeNull();
    expect(mention!.timestamp).toBe('9:00');
  });

  it('returns null when there are no mentions', () => {
    const node = { label: 'Pricing strategy', content: '', keyTerms: [] };
    expect(findNearestEntityMention(node, 'Nothing time-related here.', null, 100)).toBeNull();
  });

  it('picks the earlier mention when distances are equal', () => {
    const node = { label: 'Entity', content: '', keyTerms: [] };
    const content = 'At 5:00 Entity is first. At 7:00 Entity is second.';
    // Playhead at 6:00 (360s) — both are equidistant (60s from 300s, 60s from 420s)
    // reduce picks the first one encountered with same distance
    const mention = findNearestEntityMention(node, content, null, 360);
    expect(mention).not.toBeNull();
    expect(mention!.timestamp).toBe('5:00');
  });
});

describe('getRankedMentionsForEntity', () => {
  // Cubic review, PR #224: segmentEndSeconds previously enforced a 5s
  // MINIMUM window via Math.max AFTER the video-duration upper-bound clamp
  // -- a mention within the video's final 5 seconds produced a segment end
  // past the video's own duration.
  it('never produces a segmentEndSeconds past the video duration, even for a mention near the very end', () => {
    const node = { label: 'Closer', content: '', keyTerms: [] };
    // Video is 100s long; mention at 98s -- only 2s of real room left.
    const content = 'At 1:38 the Closer wraps up the talk.';
    const index = getRankedMentionsForEntity('node-1', node, content, null, 100);
    expect(index.mentions.length).toBe(1);
    expect(index.mentions[0]!.segmentEndSeconds).toBeLessThanOrEqual(100);
  });

  // Same class of bug: two mentions <5s apart previously let the minimum-
  // window floor push the first mention's segment end past the second
  // mention's own start.
  it('never produces a segmentEndSeconds past the NEXT mention when mentions are close together', () => {
    const node = { label: 'Rapid', content: '', keyTerms: [] };
    const content = 'At 0:10 Rapid is introduced. At 0:12 Rapid is mentioned again.';
    const index = getRankedMentionsForEntity('node-1', node, content, null, 600);
    expect(index.mentions.length).toBe(2);
    // Results are significance-sorted, not chronological -- find the
    // earlier-seeking mention explicitly rather than assuming array order.
    const [earlier, later] = [...index.mentions].sort((mentionA, mentionB) => mentionA.seekSeconds - mentionB.seekSeconds);
    expect(earlier!.segmentEndSeconds).toBeLessThanOrEqual(later!.seekSeconds);
  });

  // CodeRabbit review, 2026-08-08: the 5s-minimum-window fix above was
  // itself relaxed to a 0.5s floor, but that floor was applied AFTER the
  // upper-bound clamps without being clamped against them -- a mention
  // with LESS than 0.5s of real room could still get pushed past the
  // bound by the floor itself. `videoDuration` comes from real video
  // metadata (a float), while mention timestamps are integer-second
  // granularity (the "MM:SS" regex) -- so a sub-second gap between a
  // mention and the video's real end is a realistic case, unlike two
  // distinct mentions being <1s apart (impossible at this granularity).
  it('never exceeds video duration even when less than 0.5s of room remains', () => {
    const node = { label: 'Ender', content: '', keyTerms: [] };
    // Mention resolves to exactly 99s ("1:39"); real video duration is
    // 99.3s -- only 0.3s of genuine room left.
    const content = 'At 1:39 Ender delivers the final line.';
    const index = getRankedMentionsForEntity('node-1', node, content, null, 99.3);
    expect(index.mentions.length).toBe(1);
    expect(index.mentions[0]!.segmentEndSeconds).toBeLessThanOrEqual(99.3);
  });

  it('returns an empty mentions array (not a crash) when the entity has no resolvable mentions', () => {
    const node = { label: 'Nonexistent', content: '', keyTerms: [] };
    const index = getRankedMentionsForEntity('node-1', node, 'Nothing time-related here.', null, 600);
    expect(index.mentions).toEqual([]);
  });

  // Cubic review, PR #224 (issue ab9d49eb): segmentEndSeconds used to derive
  // its "next mention" boundary from `matches[idx + 1]` -- the next mention
  // in TEXT order -- not the next one chronologically. LLM-narrated prose
  // can flash back to an earlier timestamp mid-paragraph, so text order and
  // chronological order aren't guaranteed to match. Here "Flow" is
  // mentioned at 0:40 (text position 1), then a flashback references 0:10
  // (text position 2), then 0:45 (text position 3). The 0:40 mention's real
  // chronological successor is 0:45, not the textually-next 0:10 mention --
  // a buggy text-order implementation would let the 0:40 segment run to
  // 0:40+30=70s, straight through the 0:45 mention's own start.
  it('derives segmentEndSeconds from the chronologically-next mention, not the next one in text order', () => {
    const node = { label: 'Flow', content: '', keyTerms: [] };
    const content = 'At 0:40 Flow happens once. Later flashback: at 0:10 Flow was foreshadowed. Then at 0:45 Flow concludes.';
    const index = getRankedMentionsForEntity('node-1', node, content, null, 600);
    expect(index.mentions.length).toBe(3);
    const mentionAt40 = index.mentions.find((mention) => mention.seekSeconds === 40);
    expect(mentionAt40).toBeDefined();
    expect(mentionAt40!.segmentEndSeconds).toBeLessThanOrEqual(45);
  });

  // Cubic review PR #224 (P2.14, verified in 2026-08-08 re-audit): equal
  // significance scores had no tiebreaker, leaving ranking order
  // non-deterministic for entities whose mentions score identically.
  it('tie-breaks equal significance scores chronologically', () => {
    const node = { label: 'Same', content: '', keyTerms: [] };
    // Identical surrounding prose for both mentions -> identical TF-IDF/
    // density/position-adjacent scoring is plausible; regardless of the
    // actual scores, verify the invariant: among any group of mentions
    // that end up with equal significance, they are ordered by seekSeconds.
    const content = 'At 0:05 Same appears. At 0:15 Same appears.';
    const index = getRankedMentionsForEntity('node-1', node, content, null, 600);
    expect(index.mentions.length).toBe(2);
    for (let i = 1; i < index.mentions.length; i++) {
      const prev = index.mentions[i - 1]!;
      const curr = index.mentions[i]!;
      if (prev.significance === curr.significance) {
        expect(prev.seekSeconds).toBeLessThanOrEqual(curr.seekSeconds);
      }
    }
  });
});
