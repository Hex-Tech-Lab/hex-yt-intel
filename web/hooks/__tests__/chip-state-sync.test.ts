import { describe, it, expect, beforeEach } from 'vitest';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { useAnalysisMetadataStore } from '@/lib/stores/analysis-metadata-store';
import { mapHistoryOverviewRow, type RawHistoryOverviewRow } from '@/lib/utils/history-overview';
import { auxStatusFromAnalysisPayload } from '@/lib/utils/aux-status-from-report';

describe('Chip State Sync Contract', () => {
  beforeEach(() => {
    useSynthesisNucleus.getState().reset();
  });

  it('ensures HistoryOverviewItem and auxStatusFromAnalysisPayload agree for the same payload', () => {
    const rawRow: RawHistoryOverviewRow = {
      base_video_id: 'v123',
      latest_analysis_id: 'a123',
      title: 'Sample Video',
      channel_title: 'Sample Channel',
      first_analyzed_at: '2026-08-07T00:00:00Z',
      last_analyzed_at: '2026-08-07T00:00:00Z',
      last_viewed_at: null,
      times_analyzed: 1,
      views: 1,
      best_dimensions: 11,
      present_dimensions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      status: 'complete',
      has_digest: true,
      has_description: false,
      has_channel_meta: true,
      has_comments: false,
      has_chapters: true,
      client_platform: 'desktop',
    };

    const historyItem = mapHistoryOverviewRow(rawRow);

    const payload = {
      videoMetadata: { description: '' },
      channelMeta: { subscriberCount: 1000 },
      comments: [],
    };

    const auxStatus = auxStatusFromAnalysisPayload(payload);

    expect(historyItem.hasDescription).toBe(auxStatus.hasDescription);
    expect(historyItem.hasChannelMeta).toBe(auxStatus.hasChannelMeta);
    expect(historyItem.hasComments).toBe(auxStatus.hasComments);
  });

  it('populates rawAnalysisPayload in synthesis nucleus store on initializeAnalysis with analysisPayload', () => {
    const payload = {
      videoMetadata: { description: 'Full video description here' },
      channelMeta: { subscriberCount: 50000 },
      comments: [{ text: 'Great video' }],
    };

    useSynthesisNucleus.getState().initializeAnalysis({
      id: 'a123',
      videoId: 'v123',
      title: 'Restored Video',
      analysisPayload: payload,
    });

    const storePayload = useSynthesisNucleus.getState().rawAnalysisPayload;
    expect(storePayload).toBe(payload);

    const auxStatus = auxStatusFromAnalysisPayload(storePayload);
    expect(auxStatus.hasDescription).toBe(true);
    expect(auxStatus.hasChannelMeta).toBe(true);
    expect(auxStatus.hasComments).toBe(true);
  });

  it('clears rawAnalysisPayload when synthesis nucleus is reset or switched', () => {
    useSynthesisNucleus.getState().initializeAnalysis({
      id: 'a123',
      videoId: 'v123',
      title: 'Restored Video',
      analysisPayload: {
        videoMetadata: { description: 'Video 1' },
      },
    });

    expect(useSynthesisNucleus.getState().rawAnalysisPayload).not.toBeNull();

    useSynthesisNucleus.getState().reset();
    expect(useSynthesisNucleus.getState().rawAnalysisPayload).toBeNull();
  });
});
