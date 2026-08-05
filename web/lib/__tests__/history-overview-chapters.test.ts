import { describe, it, expect } from 'vitest';
import { mapHistoryOverviewRow } from '@/lib/utils/history-overview';
import type { RawHistoryOverviewRow } from '@/lib/utils/history-overview';

describe('mapHistoryOverviewRow - hasChapters 3-state mapping', () => {
  const baseRow: RawHistoryOverviewRow = {
    base_video_id: 'vid123',
    latest_analysis_id: '00000000-0000-0000-0000-000000000001',
    title: 'Test Video',
    channel_title: 'Test Channel',
    first_analyzed_at: '2026-08-01T00:00:00Z',
    last_analyzed_at: '2026-08-01T00:00:00Z',
    last_viewed_at: null,
    times_analyzed: 1,
    views: 1,
    best_dimensions: 11,
    present_dimensions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    status: 'complete',
    has_digest: true,
    has_description: true,
    has_channel_meta: true,
    has_comments: true,
    has_chapters: null,
    client_platform: 'web',
  };

  it('maps has_chapters = true correctly (green state)', () => {
    const item = mapHistoryOverviewRow({ ...baseRow, has_chapters: true });
    expect(item.hasChapters).toBe(true);
  });

  it('maps has_chapters = false correctly (orange state)', () => {
    const item = mapHistoryOverviewRow({ ...baseRow, has_chapters: false });
    expect(item.hasChapters).toBe(false);
  });

  it('maps has_chapters = null to null (grey state)', () => {
    const item = mapHistoryOverviewRow({ ...baseRow, has_chapters: null });
    expect(item.hasChapters).toBeNull();
  });
});
