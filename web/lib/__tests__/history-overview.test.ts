/**
 * History overview mapping — the pure boundary between the
 * `get_user_history_overview` aggregation rows and the domain item the UI reads.
 */
import { describe, it, expect } from 'vitest';
import {
  computeMissingDimensions,
  mapHistoryOverviewRow,
  type RawHistoryOverviewRow,
} from '@/lib/utils/history-overview';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';

describe('computeMissingDimensions', () => {
  it('returns all dimensions when none are present', () => {
    expect(computeMissingDimensions([])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('returns none when the full set is present', () => {
    const full = Array.from({ length: TOTAL_DIMENSIONS }, (_, i) => i + 1);
    expect(computeMissingDimensions(full)).toEqual([]);
  });

  it('returns the ascending complement for a partial set', () => {
    expect(computeMissingDimensions([1, 2, 5, 8, 11])).toEqual([3, 4, 6, 7, 9, 10]);
  });

  it('is order-insensitive and ignores out-of-range noise', () => {
    expect(computeMissingDimensions([11, 2, 1, 99, 0])).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

function baseRow(overrides: Partial<RawHistoryOverviewRow> = {}): RawHistoryOverviewRow {
  return {
    base_video_id: 'abc123',
    latest_analysis_id: 'analysis-1',
    title: 'A Great Video',
    channel_title: 'Some Channel',
    first_analyzed_at: '2026-06-01T00:00:00Z',
    last_analyzed_at: '2026-06-02T00:00:00Z',
    last_viewed_at: '2026-06-03T00:00:00Z',
    times_analyzed: 3,
    views: 5,
    best_dimensions: 11,
    present_dimensions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    status: 'complete',
    has_digest: true,
    has_description: true,
    has_channel_meta: true,
    has_comments: true,
    client_platform: 'ios',
    ...overrides,
  };
}

describe('mapHistoryOverviewRow', () => {
  it('maps a complete row to camelCase with no missing dimensions', () => {
    const item = mapHistoryOverviewRow(baseRow());
    expect(item).toEqual({
      baseVideoId: 'abc123',
      analysisId: 'analysis-1',
      title: 'A Great Video',
      channelTitle: 'Some Channel',
      firstAnalyzedAt: '2026-06-01T00:00:00Z',
      lastAnalyzedAt: '2026-06-02T00:00:00Z',
      lastViewedAt: '2026-06-03T00:00:00Z',
      timesAnalyzed: 3,
      views: 5,
      bestDimensions: 11,
      presentDimensions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      missingDimensions: [],
      status: 'complete',
      hasDigest: true,
      hasDescription: true,
      hasChannelMeta: true,
      hasComments: true,
      clientPlatform: 'ios',
    });
  });

  it('nulls clientPlatform for rows predating the column', () => {
    const item = mapHistoryOverviewRow(baseRow({ client_platform: null }));
    expect(item.clientPlatform).toBeNull();
  });

  it('nulls lastViewedAt for rows never viewed since the column was added', () => {
    const item = mapHistoryOverviewRow(baseRow({ last_viewed_at: null }));
    expect(item.lastViewedAt).toBeNull();
  });

  it('coerces PostgREST bigint strings (count/sum) to numbers', () => {
    const item = mapHistoryOverviewRow(baseRow({ times_analyzed: '25', views: '40' }));
    expect(item.timesAnalyzed).toBe(25);
    expect(item.views).toBe(40);
  });

  it('derives missing dimensions from a partial winner', () => {
    const item = mapHistoryOverviewRow(
      baseRow({ present_dimensions: [1, 2, 3, 4, 5, 6, 7, 8], best_dimensions: 8, status: 'partial' })
    );
    expect(item.presentDimensions).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(item.missingDimensions).toEqual([9, 10, 11]);
    expect(item.status).toBe('partial');
  });

  it('treats a null/failed winner as zero dimensions, all missing', () => {
    const item = mapHistoryOverviewRow(
      baseRow({ present_dimensions: null, best_dimensions: null, status: 'failed' })
    );
    expect(item.bestDimensions).toBe(0);
    expect(item.presentDimensions).toEqual([]);
    expect(item.missingDimensions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('falls back to a video-id title when base_video_id is known, and null channel', () => {
    const item = mapHistoryOverviewRow(baseRow({ title: null, channel_title: null }));
    expect(item.title).toBe('Video (abc123)');
    expect(item.channelTitle).toBeNull();
  });

  it('falls back to a generic placeholder title when base_video_id is also missing', () => {
    const item = mapHistoryOverviewRow(baseRow({ title: null, channel_title: null, base_video_id: '' }));
    expect(item.title).toBe('Untitled Analysis');
  });

  it('sorts an out-of-order present_dimensions set', () => {
    const item = mapHistoryOverviewRow(baseRow({ present_dimensions: [3, 1, 2], best_dimensions: 3, status: 'partial' }));
    expect(item.presentDimensions).toEqual([1, 2, 3]);
    expect(item.missingDimensions).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
  });
});
