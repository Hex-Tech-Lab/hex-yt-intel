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

    const nextBtn = getByRole('button', { name: 'Next ranked mention' });
    const prevBtn = getByRole('button', { name: 'Previous ranked mention' });

    expect((prevBtn as HTMLButtonElement).disabled).toBe(true);
    expect((nextBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(nextBtn);

    expect(useVideoStore.getState().seekTo).toBe(240);
    expect((prevBtn as HTMLButtonElement).disabled).toBe(false);
    expect((nextBtn as HTMLButtonElement).disabled).toBe(true);
  });
});
