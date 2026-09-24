/**
 * ApifyTranscriptProvider — Adapter implementing TranscriptProviderPort
 *
 * Backed by the Apify actor `johnvc~youtubetranscripts`
 * (run-sync-get-dataset-items: one synchronous request, no polling).
 * Added 2026-09-24 during the Decodo 429 incident (free Decodo quota
 * exhausted in production; YouTube blocks datacenter IPs) — this provider
 * runs first in the configurable transcript chain by default.
 */

import type { TranscriptProviderPort, TranscriptResult } from '../../ports/TranscriptProviderPort';

interface ApifyTimestampedItem {
  text?: string;
  start?: number;
  duration?: number;
}

interface ApifyDatasetItem {
  success?: boolean;
  error_message?: string;
  language_code?: string;
  timestamped?: ApifyTimestampedItem[];
  non_timestamped?: string[];
}

export class ApifyTranscriptProvider implements TranscriptProviderPort {
  private apifyToken?: string;

  constructor(apifyToken?: string) {
    this.apifyToken = apifyToken;
  }

  async fetch(videoId: string): Promise<TranscriptResult> {
    if (!this.apifyToken) throw new Error('Apify API token not configured');

    // 130s > the actor's own 120s timeout so Apify's own timeout response
    // arrives before ours cuts the connection.
    const url = 'https://api.apify.com/v2/acts/johnvc~youtubetranscripts/run-sync-get-dataset-items?timeout=120&maxTotalChargeUsd=0.05';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apifyToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        youtube_url: `https://www.youtube.com/watch?v=${videoId}`,
        // Ordered list of languages the product analyses. Derived empirically
        // from languages observed in completed analyses (2026-09-24 DB query):
        // en/ar dominate (product targets) plus de/ja/nl/he seen repeatedly in
        // real traffic (e.g. LTNVA2iP9YU de, 9T8L73AidFY ja, vmZzZ9Tv-ks nl,
        // sw22FMB_SWI he). A language Apify returns outside this list is
        // still accepted below.
        languages: ['en', 'ar', 'de', 'ja', 'nl', 'he'],
        include_metadata: false,
      }),
      signal: AbortSignal.timeout(130000),
    });

    if (!response.ok) throw new Error(`Apify fail: ${response.status}`);

    const items = await response.json() as ApifyDatasetItem[];
    const item = Array.isArray(items) ? items[0] : undefined;
    if (!item) throw new Error('Apify returned no dataset items');
    if (item.success !== true) {
      throw new Error(`Apify actor reported failure: ${item.error_message || 'unknown error'}`);
    }

    const timestamped = item.timestamped ?? [];
    if (timestamped.length === 0) throw new Error('Apify returned empty timestamped transcript');

    const segments = timestamped
      .map(s => ({
        text: (s.text ?? '').replace(/\s+/g, ' ').trim(),
        start: typeof s.start === 'number' ? s.start : NaN,
        duration: typeof s.duration === 'number' ? s.duration : NaN,
      }))
      .filter(s => s.text.length > 0 && !isNaN(s.start) && !isNaN(s.duration) && s.start >= 0 && s.duration > 0 && s.start < 86400);

    if (segments.length === 0) throw new Error('Apify transcript had no valid segments');

    const transcript = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
    if (!transcript) throw new Error('Empty transcript after processing');

    return {
      videoId,
      transcript,
      language: item.language_code || 'en',
      segments,
    };
  }
}
