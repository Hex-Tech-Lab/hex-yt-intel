/**
 * Unit test suite for EntityMentionTimeline & getRankedMentionsForEntity (ADR 025).
 * Tests marker positioning math, significance-ranking order, forward/back navigation,
 * and auto-segment playback boundaries.
 */

// @vitest-environment happy-dom

import { createElement } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { EntityMentionTimeline } from '@/components/templates/console/EntityMentionTimeline';
import { getRankedMentionsForEntity, type RankedEntityMention } from '@/lib/utils/entity-time-seek';
import { useVideoStore } from '@/store/useVideoStore';

describe('getRankedMentionsForEntity', () => {
  it('returns empty mentions when no matches found', () => {
    const res = getRankedMentionsForEntity('node-1', { label: 'Quantum Computing' }, 'No matches here');
    expect(res.nodeId).toBe('node-1');
    expect(res.mentions).toEqual([]);
  });

  it('ranks mentions by significance and calculates segment boundaries', () => {
    const dimensionContent = `
      In this section [01:00], Quantum Computing is discussed.
      Later on [05:00], Quantum Computing appears again for details.
    `;
    const res = getRankedMentionsForEntity('node-quantum', { label: 'Quantum Computing', dimension: 3 }, dimensionContent, [], 600);

    expect(res.nodeId).toBe('node-quantum');
    expect(res.mentions.length).toBe(2);
    // CodeRabbit review, 2026-08-08: `mentions[0].significance >=
    // mentions[1].significance` is tautologically true by construction --
    // getRankedMentionsForEntity always sorts descending by significance,
    // so this alone would still pass even if scoring were completely
    // broken and returned an identical constant for every mention. Assert
    // the scores actually DIFFER (real differentiation happened) instead
    // of just re-checking the sort the function itself guarantees.
    expect(res.mentions[0]!.significance).not.toBe(res.mentions[1]!.significance);
    expect(res.mentions[0]!.significance).toBeGreaterThan(res.mentions[1]!.significance);
    expect(res.mentions[0]!.dimensionNumber).toBe(3);
    // Reconciled with real significance scoring (Cubic review, PR #224/#225):
    // WHICH specific mention (60s or 300s) ranks first is determined by
    // real TF-IDF/density/position weighting, not a fixed occurrence-order
    // assumption -- assert the invariant the scoring contract actually
    // guarantees (both mentions present with valid, self-consistent
    // boundaries), not which one happens to win for this fixture text.
    const seekTimes = res.mentions.map((mention) => mention.seekSeconds).sort((secondsA, secondsB) => secondsA - secondsB);
    expect(seekTimes).toEqual([60, 300]);
    for (const mention of res.mentions) {
      expect(mention.segmentEndSeconds).toBeGreaterThan(mention.seekSeconds);
    }
  });
});

describe('EntityMentionTimeline Component', () => {
  beforeEach(() => {
    useVideoStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  const sampleMentions: RankedEntityMention[] = [
    {
      timestamp: '01:00',
      seekSeconds: 60,
      occurrenceIndex: 0,
      segmentEndSeconds: 90,
      significance: 95,
      dimensionNumber: 1,
    },
    {
      timestamp: '04:00',
      seekSeconds: 240,
      occurrenceIndex: 1,
      segmentEndSeconds: 270,
      significance: 85,
      dimensionNumber: 2,
    },
  ];

  it('does not render when mentions length is <= 1', () => {
    const { container } = render(
      createElement(EntityMentionTimeline, {
        entityId: 'node-1',
        entityLabel: 'Single Mention Entity',
        mentions: [sampleMentions[0]!],
        videoDuration: 600,
      }),
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders timeline strip with marker count when mentions > 1', () => {
    const { getByText, getByRole, getAllByRole } = render(
      createElement(EntityMentionTimeline, {
        entityId: 'node-1',
        entityLabel: 'Machine Learning',
        mentions: sampleMentions,
        videoDuration: 600,
      }),
    );

    expect(getByText('Machine Learning')).toBeTruthy();
    expect(getByText('2 mentions')).toBeTruthy();

    const region = getByRole('region');
    expect(region).toBeTruthy();
    expect(region.getAttribute('aria-label')).toContain('Machine Learning');

    const markers = getAllByRole('button', { name: /Jump to mention/i });
    expect(markers.length).toBe(2);
  });

  it('navigates through mentions using Next / Prev controls', () => {
    const { getByRole } = render(
      createElement(EntityMentionTimeline, {
        entityId: 'node-1',
        entityLabel: 'Machine Learning',
        mentions: sampleMentions,
        videoDuration: 600,
      }),
    );

    const nextBtn = getByRole('button', { name: 'Next mention' });
    const prevBtn = getByRole('button', { name: 'Previous mention' });

    expect((prevBtn as HTMLButtonElement).disabled).toBe(true);
    expect((nextBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(nextBtn);

    expect(useVideoStore.getState().seekTo).toBe(240);
    expect((prevBtn as HTMLButtonElement).disabled).toBe(false);
    expect((nextBtn as HTMLButtonElement).disabled).toBe(true);
  });

  // Root cause (live-reported, 2026-08-15): `mentions` arrives sorted by
  // significance descending (ADR 025), but this component renders a
  // time-positioned track -- indexing the "#N of M" counter and the
  // highlighted marker straight into the significance-sorted array desynced
  // them from the dots' actual left-to-right time order. Fixture is a valid
  // ADR 025 output (significance strictly descending: 95, 85, 60) whose
  // chronological order (60s, 150s, 240s) still differs from it, to catch a
  // regression back to indexing the raw `mentions` prop.
  it('counts, highlights, and navigates by time order, not the incoming significance-ranked order', () => {
    const outOfOrderMentions: RankedEntityMention[] = [
      { timestamp: '04:00', seekSeconds: 240, occurrenceIndex: 0, segmentEndSeconds: 260, significance: 95, dimensionNumber: 1 },
      { timestamp: '02:30', seekSeconds: 150, occurrenceIndex: 1, segmentEndSeconds: 170, significance: 85, dimensionNumber: 2 },
      { timestamp: '01:00', seekSeconds: 60, occurrenceIndex: 2, segmentEndSeconds: 90, significance: 60, dimensionNumber: 3 },
    ];

    const { getByText, getByRole, getAllByRole } = render(
      createElement(EntityMentionTimeline, {
        entityId: 'node-1',
        entityLabel: 'Test Entity',
        mentions: outOfOrderMentions,
        videoDuration: 600,
      }),
    );

    // Starts at index 0 -> the chronologically-first mention (60s), which is
    // significance-rank #3 in the incoming prop, NOT rank #1.
    expect(getByText('#1 of 3')).toBeTruthy();
    expect(useVideoStore.getState().seekTo).toBeNull();

    const markers = getAllByRole('button', { name: /Jump to mention/i });
    expect(markers.length).toBe(3);
    // Markers render left-to-right in time order: 60s, 150s, 240s.
    const leftOffsets = markers.map((marker) => parseFloat((marker as HTMLElement).style.left));
    expect(leftOffsets[0]!).toBeLessThan(leftOffsets[1]!);
    expect(leftOffsets[1]!).toBeLessThan(leftOffsets[2]!);
    // The first marker in DOM order (60s, chronologically first) is the
    // active one, matching "#1 of 3" -- not the 240s marker, which is
    // significance-rank #1 in the incoming prop.
    expect(markers[0]!.className).toContain('scale-110');
    expect(markers[1]!.className).not.toContain('scale-110');
    expect(markers[2]!.className).not.toContain('scale-110');

    const nextBtn = getByRole('button', { name: 'Next mention' });
    // Next/Prev/marker-click all seek in the same time-ordered sequence:
    // 60 -> 150 -> 240, never jumping "backward" to the significance-rank-1
    // mention (240s) from rank-2 (150s) as raw-array indexing would.
    fireEvent.click(nextBtn);
    expect(useVideoStore.getState().seekTo).toBe(150);
    expect(getByText('#2 of 3')).toBeTruthy();

    fireEvent.click(nextBtn);
    expect(useVideoStore.getState().seekTo).toBe(240);
    expect(getByText('#3 of 3')).toBeTruthy();
  });

  it('clamps the active index when the mention set shrinks without an entityId change', () => {
    const threeMentions: RankedEntityMention[] = [
      { timestamp: '01:00', seekSeconds: 60, occurrenceIndex: 0, segmentEndSeconds: 90, significance: 95, dimensionNumber: 1 },
      { timestamp: '02:00', seekSeconds: 120, occurrenceIndex: 1, segmentEndSeconds: 140, significance: 85, dimensionNumber: 2 },
      { timestamp: '03:00', seekSeconds: 180, occurrenceIndex: 2, segmentEndSeconds: 200, significance: 75, dimensionNumber: 3 },
    ];

    const { getByText, getByRole, rerender } = render(
      createElement(EntityMentionTimeline, {
        entityId: 'node-1',
        entityLabel: 'Test Entity',
        mentions: threeMentions,
        videoDuration: 600,
      }),
    );

    fireEvent.click(getByRole('button', { name: 'Next mention' }));
    fireEvent.click(getByRole('button', { name: 'Next mention' }));
    expect(getByText('#3 of 3')).toBeTruthy();

    // Same entityId, but the mention list shrinks (e.g. re-computed after
    // new streamed dimension data) -- the reset effect (keyed on
    // entityId + mentions.length) brings the index back to the first
    // mention rather than leaving it pointing past the end; the render-time
    // clamp guards the single paint before that effect flushes, so it never
    // shows "#3 of 2" with no marker matching isActive.
    rerender(
      createElement(EntityMentionTimeline, {
        entityId: 'node-1',
        entityLabel: 'Test Entity',
        mentions: [threeMentions[0]!, threeMentions[1]!],
        videoDuration: 600,
      }),
    );

    expect(getByText('#1 of 2')).toBeTruthy();
  });
});
