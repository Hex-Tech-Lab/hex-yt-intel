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

/** Ordered language preference sent to the Apify actor (en/ar first, then YouTube caption languages). */
export const APIFY_LANGUAGE_PREFERENCE: readonly string[] = [
  'en', 'ar', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ja', 'ko', 'zh-Hans', 'zh-Hant', 'hi', 'bn', 'ur', 'id', 'ms', 'tr', 'fa', 'he', 'nl', 'sv', 'no', 'da', 'fi', 'pl', 'cs', 'sk', 'hu', 'ro', 'bg', 'uk', 'el', 'sr', 'hr', 'sl', 'lt', 'lv', 'et', 'vi', 'th', 'tl', 'ta', 'te', 'ml', 'kn', 'mr', 'gu', 'pa', 'sw', 'am', 'yo', 'zu', 'af', 'sq', 'hy', 'az', 'eu', 'be', 'bs', 'ca', 'gl', 'ka', 'kk', 'km', 'lo', 'mk', 'mn', 'ne', 'si', 'uz', 'cy', 'is', 'ga', 'mt',
];

export class ApifyTranscriptProvider implements TranscriptProviderPort {
  private apifyToken?: string;

  constructor(apifyToken?: string) {
    this.apifyToken = apifyToken;
  }

  async fetch(videoId: string): Promise<TranscriptResult> {
    if (!this.apifyToken) throw new Error('Apify API token not configured');

    // 130s > the actor's own 120s timeout so Apify's own timeout response
    // arrives before ours cuts the connection.
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(130000)]);
    const url = 'https://api.apify.com/v2/acts/johnvc~youtubetranscripts/run-sync-get-dataset-items?timeout=120&maxTotalChargeUsd=0.05';
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apifyToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          youtube_url: `https://www.youtube.com/watch?v=${videoId}`,
          // Ordered preference list. The actor returns the FIRST available
          // transcript matching a listed code and fails if none match, so the
          // list covers YouTube's caption languages (the site promises 65+),
          // product targets en/ar first. One call regardless of list length.
          languages: APIFY_LANGUAGE_PREFERENCE,
          include_metadata: false,
        }),
        signal,
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
    } finally {
      controller.abort();
    }
  }
}
