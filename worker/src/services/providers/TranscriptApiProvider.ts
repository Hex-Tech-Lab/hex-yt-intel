/**
 * TranscriptApiProvider — Adapter implementing TranscriptProviderPort
 *
 * Backed by transcriptapi.com (GET /api/v2/youtube/transcript, one fast
 * synchronous call ~0.4-0.6s). Added 2026-09-25 as a backup provider for
 * the transcript chain; it is registered in the order parser as
 * 'transcriptapi' but is NOT in the default order — enabling it is an
 * explicit TRANSCRIPT_PROVIDER_ORDER decision.
 */

import type { TranscriptProviderPort, TranscriptResult } from '../../ports/TranscriptProviderPort';

interface TranscriptApiSegment {
  text?: string;
  start?: number;
  duration?: number;
}

interface TranscriptApiResponse {
  video_id?: string;
  /** "en" for manual captions, "asr-de" style for auto-generated (ASR). */
  language?: string;
  transcript?: TranscriptApiSegment[];
}

export class TranscriptApiProvider implements TranscriptProviderPort {
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  async fetch(videoId: string): Promise<TranscriptResult> {
    if (!this.apiKey) throw new Error('TranscriptAPI key not configured');

    // 30s is generous for a call measured at 0.4-0.6s; the chain itself keeps
    // falling through on any thrown error, so a slow/hung provider only
    // wastes its own slice of the budget.
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
    const url = `https://transcriptapi.com/api/v2/youtube/transcript?video_url=${encodeURIComponent(videoId)}&format=json`;
    try {
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal,
      });

      if (!response.ok) throw new Error(`TranscriptAPI fail: ${response.status}`);

      const body = await response.json() as TranscriptApiResponse;
      if (!body || !Array.isArray(body.transcript)) throw new Error('TranscriptAPI returned malformed body');

      const segments = body.transcript
        .map(s => ({
          text: (s.text ?? '').replace(/\s+/g, ' ').trim(),
          start: typeof s.start === 'number' ? s.start : NaN,
          duration: typeof s.duration === 'number' ? s.duration : NaN,
        }))
        .filter(s => s.text.length > 0 && !isNaN(s.start) && !isNaN(s.duration) && s.start >= 0 && s.duration > 0 && s.start < 86400);

      if (segments.length === 0) throw new Error('TranscriptAPI transcript had no valid segments');

      const transcript = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
      if (!transcript) throw new Error('Empty transcript after processing');

      // "asr-de" → language "de" (auto-generated marker stripped; the port
      // carries no auto-generated flag — same as the Apify tier).
      const language = (body.language ?? 'en').replace(/^asr-/, '') || 'en';

      return {
        videoId,
        transcript,
        language,
        segments,
      };
    } finally {
      controller.abort();
    }
  }
}