/**
 * TranscriptExtractor - Pure Service
 *
 * HEXAGONAL ARCHITECTURE:
 * - PORT: ITranscriptProvider (fetch(videoId: string): Promise<string>)
 * - ADAPTER: YouTube Caption API + Decodo fallback
 * - DOMAIN: Caption parsing, language fallback, timeout protection
 *
 * Extracts video transcripts from YouTube's timedtext API with:
 * - English language prioritization
 * - Fallback to first available language
 * - 5-second timeout per request
 * - XML/JSON parsing and reconstruction
 */

import { fetchWithProxy } from './http-utils';
import { getRandomUserAgent } from './user-agent';

export interface TranscriptResult {
  videoId: string;
  transcript: string;
  language: string;
}

export class TranscriptExtractor {
  private residentialProxyUrl?: string;

  constructor(residentialProxyUrl?: string) {
    this.residentialProxyUrl = residentialProxyUrl;
  }

  /**
   * Fetch and parse video transcript from YouTube
   */
  async fetch(videoId: string): Promise<TranscriptResult> {
    if (!this.isValidVideoId(videoId)) {
      throw new Error(`Invalid video ID format: ${videoId}`);
    }

    // Step 1: Fetch caption track metadata (XML)
    const { langCode } = await this.fetchCaptionMetadata(videoId);

    // Step 2: Fetch actual transcript (JSON)
    const transcript = await this.fetchTranscriptContent(videoId, langCode);

    return {
      videoId,
      transcript,
      language: langCode,
    };
  }

  /**
   * Validate video ID format (11 chars, alphanumeric + hyphen + underscore)
   */
  private isValidVideoId(videoId: string): boolean {
    return /^[a-zA-Z0-9_-]{11}$/.test(videoId);
  }

  /**
   * Fetch caption track list and find English or first available language
   */
  private async fetchCaptionMetadata(
    videoId: string
  ): Promise<{ langCode: string }> {
    const metadataUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&type=list`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetchWithProxy(
        metadataUrl,
        {
          signal: controller.signal,
          headers: { 'User-Agent': getRandomUserAgent() },
        },
        this.residentialProxyUrl
      );

      if (!response.ok) {
        throw new Error(`Caption metadata fetch failed: ${response.status}`);
      }

      const metadataText = await response.text();
      const langCode = this.parseCaptionLanguage(metadataText);

      if (!langCode) {
        throw new Error('No captions available for this video');
      }

      return { langCode };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Parse XML response to extract language codes
   * Prioritize English, fallback to first available
   */
  private parseCaptionLanguage(xml: string): string | null {
    const captionRegex = /lang_code="([^"]+)"/g;
    const matches = Array.from(xml.matchAll(captionRegex));

    if (matches.length === 0) {
      return null;
    }

    // Prioritize English
    const englishMatch = matches.find((m) => m[1].startsWith('en'));
    if (englishMatch) {
      return englishMatch[1];
    }

    // Fallback to first available
    return matches[0][1];
  }

  /**
   * Fetch transcript content in JSON format
   */
  private async fetchTranscriptContent(
    videoId: string,
    langCode: string
  ): Promise<string> {
    const transcriptUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${langCode}&fmt=json`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetchWithProxy(
        transcriptUrl,
        {
          signal: controller.signal,
          headers: { 'User-Agent': getRandomUserAgent() },
        },
        this.residentialProxyUrl
      );

      if (!response.ok) {
        throw new Error(`Transcript content fetch failed: ${response.status}`);
      }

      const captionData = (await response.json()) as {
        events?: Array<{ segs?: Array<{ utf8?: string }> }>;
      };

      const transcript = this.reconstructTranscript(captionData);

      if (!transcript) {
        throw new Error('Transcript is empty after parsing');
      }

      return transcript;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Reconstruct transcript string from caption events
   */
  private reconstructTranscript(captionData: {
    events?: Array<{ segs?: Array<{ utf8?: string }> }>;
  }): string {
    if (!captionData.events || !Array.isArray(captionData.events)) {
      return '';
    }

    return captionData.events
      .filter((event) => event && Array.isArray(event.segs) && event.segs.length > 0)
      .map((event) => {
        return (event.segs || []).map((seg) => seg?.utf8 || '').join('');
      })
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
