/**
 * DecodoTranscriptProvider — Adapter implementing TranscriptProviderPort
 *
 * Extracted verbatim from TranscriptExtractor.fetchWithDecodo (2026-09-24,
 * configurable-provider-chain refactor). Behaviour unchanged.
 */

import { fetchWithProxy } from '../http-utils';
import type { TranscriptProviderPort, TranscriptResult } from '../../ports/TranscriptProviderPort';

/**
 * DecodoTranscriptProvider — Adapter implementing TranscriptProviderPort.
 *
 * Uses Decodo's youtube_subtitles scrape target as an alternative transcript
 * source behind the residential proxy (second tier in the default chain).
 */
export class DecodoTranscriptProvider implements TranscriptProviderPort {
  private residentialProxyUrl?: string;
  private decodoApiKey?: string;

  constructor(residentialProxyUrl?: string, decodoApiKey?: string) {
    this.residentialProxyUrl = residentialProxyUrl;
    this.decodoApiKey = decodoApiKey;
  }

  /** Scrapes the transcript via Decodo's youtube_subtitles target and normalises its events into segments. */
  async fetch(videoId: string): Promise<TranscriptResult> { // skipcq: JS-R1005 (linear scrape/parse pipeline; branches are sequential extraction steps)
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
        langCode = preferred.find(lang => langs.includes(lang)) || langs[0] || 'en';
        events = autoGen[langCode]?.events;
      }
      if (!events) {
        const langs = Object.keys(content).filter(k => typeof content[k] === 'object');
        const preferred = ['en', 'ar', 'en-auto', 'a-en', 'ar-auto'];
        langCode = preferred.find(lang => langs.includes(lang)) || (langs.includes('en') ? 'en' : (langs[0] ?? 'en'));
        const langData = content[langCode] as { events?: typeof events } | undefined;
        events = langData?.events;
      }
      if (!events?.length) throw new Error('No transcript events found');

      let cumulative = 0;
      const segments = events.map(event => {
        const segs = event.segs ?? [];
        const text = segs.map(seg => seg.utf8 || '').join('').replace(/\s+/g, ' ').trim();
        const start = typeof event.tStartMs === 'number' ? event.tStartMs / 1000 : typeof event.tStart === 'number' ? event.tStart : cumulative * 3;
        const duration = typeof event.dDurationMs === 'number' ? event.dDurationMs / 1000 : typeof event.dDuration === 'number' ? event.dDuration : 3;
        cumulative++;
        return { start, duration, text };
      }).filter(segment => segment.text.length > 0)
        .filter(segment => {
          return !isNaN(segment.start) && !isNaN(segment.duration) && segment.start >= 0 && segment.duration > 0 && segment.start < 86400;
        });

      const transcript = segments.map(segment => segment.text).join(' ').replace(/\s+/g, ' ').trim();

      if (!transcript) throw new Error('Empty transcript after processing');

      return { videoId, transcript, language: langCode, segments };
    } finally {
      controller.abort();
    }
  }
}