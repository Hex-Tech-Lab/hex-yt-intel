/**
 * DecodoTranscriptProvider — Adapter implementing TranscriptProviderPort
 *
 * Extracted verbatim from TranscriptExtractor.fetchWithDecodo (2026-09-24,
 * configurable-provider-chain refactor). Behaviour unchanged.
 */

import { fetchWithProxy } from '../http-utils';
import type { TranscriptProviderPort, TranscriptResult } from '../../ports/TranscriptProviderPort';

export class DecodoTranscriptProvider implements TranscriptProviderPort {
  private residentialProxyUrl?: string;
  private decodoApiKey?: string;

  constructor(residentialProxyUrl?: string, decodoApiKey?: string) {
    this.residentialProxyUrl = residentialProxyUrl;
    this.decodoApiKey = decodoApiKey;
  }

  async fetch(videoId: string): Promise<TranscriptResult> {
    if (!this.decodoApiKey) throw new Error('Decodo API key not configured');
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
    try {
      const response = await fetchWithProxy('https://scraper-api.decodo.com/v2/scrape', {
        method: 'POST',
        signal,
        headers: {
          'Authorization': `Basic ${this.decodoApiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          target: 'youtube_subtitles',
          query: videoId,
        }),
      }, this.residentialProxyUrl);
      if (!response.ok) throw new Error(`Decodo fail: ${response.status}`);
      const data = await response.json() as {
        results?: Array<{ content?: Record<string, unknown> }>;
      };
      const content = data.results?.[0]?.content;
      if (!content) throw new Error('Decodo returned empty content');

      let langCode = 'en';
      let events: Array<{ segs?: Array<{ utf8?: string }>, tStartMs?: number, dDurationMs?: number, tStart?: number, dDuration?: number }> | undefined;

      const autoGen = content.auto_generated as Record<string, { events?: typeof events }> | undefined;
      if (autoGen && typeof autoGen === 'object') {
        const langs = Object.keys(autoGen);
        const preferred = ['en', 'ar', 'en-auto', 'a-en'];
        langCode = preferred.find(l => langs.includes(l)) || langs[0] || 'en';
        events = autoGen[langCode]?.events;
      }
      if (!events) {
        const langs = Object.keys(content).filter(k => typeof content[k] === 'object');
        const preferred = ['en', 'ar', 'en-auto', 'a-en', 'ar-auto'];
        langCode = preferred.find(l => langs.includes(l)) || (langs.includes('en') ? 'en' : (langs[0] ?? 'en'));
        const langData = content[langCode] as { events?: typeof events } | undefined;
        events = langData?.events;
      }
      if (!events?.length) throw new Error('No transcript events found');

      let cumulative = 0;
      const segments = events.filter(e => e.segs).map(e => {
        const text = e.segs!.map(s => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
        const start = typeof e.tStartMs === 'number' ? e.tStartMs / 1000 : typeof e.tStart === 'number' ? e.tStart : cumulative * 3;
        const duration = typeof e.dDurationMs === 'number' ? e.dDurationMs / 1000 : typeof e.dDuration === 'number' ? e.dDuration : 3;
        cumulative++;
        return { start, duration, text };
      }).filter(s => s.text.length > 0)
        .filter(s => {
          return !isNaN(s.start) && !isNaN(s.duration) && s.start >= 0 && s.duration > 0 && s.start < 86400;
        });

      const transcript = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();

      if (!transcript) throw new Error('Empty transcript after processing');

      return { videoId, transcript, language: langCode, segments };
    } finally {
      controller.abort();
    }
  }
}