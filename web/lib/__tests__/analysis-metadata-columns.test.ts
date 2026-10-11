import { describe, it, expect } from 'vitest';

import { metadataColumns } from '@/lib/adapters/SupabaseAnalysisAdapter';

// Regression: channel_id/published_at/thumbnail_url were never written (only the
// validation_report.metadata blob was), so the dashboard metadata panel stayed grey.
describe('metadataColumns', () => {
  it('maps job metadata to the analyses video-metadata columns', () => {
    expect(
      metadataColumns('EyC1P3hyMgI', {
        channelTitle: 'Recall',
        channelId: 'UC123',
        publishedAt: '2026-09-01T00:00:00Z',
      } as never),
    ).toEqual({
      channel_title: 'Recall',
      channel_id: 'UC123',
      published_at: '2026-09-01T00:00:00Z',
      thumbnail_url: 'https://i.ytimg.com/vi/EyC1P3hyMgI/hqdefault.jpg',
    });
  });

  it('omits fields the metadata does not carry instead of writing empties', () => {
    expect(metadataColumns('abc', undefined)).toEqual({
      thumbnail_url: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
    });
  });

  it('drops a publishedAt that is not a date rather than failing the row update', () => {
    expect(metadataColumns('abc', { channelTitle: 'c', publishedAt: 'not-a-date' } as never)).not.toHaveProperty('published_at');
  });
});
