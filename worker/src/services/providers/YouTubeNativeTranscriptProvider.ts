/**
 * YouTubeNativeTranscriptProvider — Adapter implementing TranscriptProviderPort
 *
 * Extracted verbatim from TranscriptExtractor's YouTube-native tier
 * (fetchWithYouTubeNative/fetchCaptionMetadata/fetchTranscriptContent/fetchFromPageHTML,
 * 2026-09-24 configurable-provider-chain refactor). Behaviour unchanged,
 * including the two-independent-source confirmedNoCaptions agreement rule.
 */

import { captureException } from '@sentry/cloudflare';
import { XMLParser } from 'fast-xml-parser';
import { fetchWithProxy } from '../http-utils';
import { getRandomUserAgent } from '../user-agent';
import { NoCaptionsConfirmedError } from '../../ports/TranscriptProviderPort';
import type { TranscriptProviderPort, TranscriptResult } from '../../ports/TranscriptProviderPort';

/**
 * YouTubeNativeTranscriptProvider — Adapter implementing TranscriptProviderPort.
 *
 * Scrapes YouTube's own surfaces (timedtext caption-list API, then the watch
 * page's ytInitialData) directly. Two independent sources, so a
 * NoCaptionsConfirmedError is only thrown when BOTH agree the video has no
 * captions (see the agreement rule in {@link fetch}).
 */
export class YouTubeNativeTranscriptProvider implements TranscriptProviderPort {
  private residentialProxyUrl?: string;
  private decodoApiKey?: string;

  constructor(residentialProxyUrl?: string, decodoApiKey?: string) {
    this.residentialProxyUrl = residentialProxyUrl;
    this.decodoApiKey = decodoApiKey;
  }

  /**
   * Tries the caption-list API first (returns the transcript when it works),
   * then falls back to scraping the watch page HTML. Throws
   * NoCaptionsConfirmedError only when both sources affirmatively agree the
   * video has no caption tracks; every other failure is rethrown as-is.
   */
  async fetch(videoId: string): Promise<TranscriptResult> { // skipcq: JS-R1005 (orchestrates two sub-sources; splitting adds indirection, not clarity)
    let standardApiConfirmedNone = false;
    try {
      const { langCode } = await this.fetchCaptionMetadata(videoId);
      const transcript = await this.fetchTranscriptContent(videoId, langCode);
      if (transcript) return { videoId, transcript, language: langCode };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[transcript] Standard API failed for ${videoId}: ${msg}`);
      captureException(err, { tags: { operation: 'transcript-standard-api', videoId } });
      standardApiConfirmedNone = err instanceof NoCaptionsConfirmedError;
    }

    try {
      return await this.fetchFromPageHTML(videoId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[transcript] Page HTML extraction failed for ${videoId}: ${msg}`);
      captureException(err, { tags: { operation: 'transcript-page-html-yt-native', videoId } });
      // Only confirm "no captions" when BOTH independent sources (YouTube's
      // caption-list API and the page's own ytInitialData) agree there are
      // none -- either one alone failing for an unrelated reason (network,
      // proxy, rate limit) must not produce a false "this video has no
      // captions" claim.
      if (standardApiConfirmedNone && err instanceof NoCaptionsConfirmedError) {
        throw new NoCaptionsConfirmedError(err.message);
      }
      throw err;
    }
  }

  /**
   * Fetches the watch page, extracts "captionTracks" from ytInitialData and
   * downloads the chosen track as JSON. Page fetch and track fetch share one
   * 15s deadline via the same AbortSignal (P1 fix 2026-09-25: the track
   * fetch previously used the bare controller signal with no timeout, so a
   * stalled request hung the tier until the outer finally abort).
   */
  private async fetchFromPageHTML(videoId: string): Promise<TranscriptResult> { // skipcq: JS-R1005 (linear parse pipeline; branches are sequential extraction steps)
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    try {
      const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const response = await fetchWithProxy(pageUrl, {
        headers: { 'User-Agent': getRandomUserAgent() },
        signal,
      }, this.residentialProxyUrl);
      if (!response.ok) throw new Error(`Page fetch failed: ${response.status}`);

      const html = await response.text();

      const captionMatch = html.match(/"captionTracks":\s*(\[[\s\S]*?\])\s*,/);
      if (!captionMatch) throw new NoCaptionsConfirmedError('No caption tracks found in page');

      const trackJson = captionMatch[1];
      if (!trackJson) throw new Error('Empty caption tracks JSON');

      const tracks = JSON.parse(trackJson) as Array<{
        baseUrl?: string;
        langCode?: string;
        kind?: string;
      }>;

      if (!tracks.length) throw new NoCaptionsConfirmedError('Empty caption tracks');

      const preferredLangs = ['en', 'ar', 'en-auto', 'ar-auto'];
      const asrPref = preferredLangs.map(lang => tracks.find(track => track.langCode === lang && track.kind === 'asr')).find(Boolean);
      const langPref = preferredLangs.map(lang => tracks.find(track => track.langCode?.startsWith(lang.split('-')[0] ?? lang))).find(Boolean);
      const asr = tracks.find(track => track.kind === 'asr' && track.langCode);
      const first = tracks[0];

      const chosen = asrPref || langPref || asr || first;
      if (!chosen?.baseUrl) throw new Error('No suitable caption track');

      const langCode = chosen.langCode || 'en';

      const transcriptUrl = chosen.baseUrl.includes('fmt=json')
        ? chosen.baseUrl
        : `${chosen.baseUrl}&fmt=json`;

      const transcriptResponse = await fetchWithProxy(transcriptUrl, {
        headers: { 'User-Agent': getRandomUserAgent() },
        // P1 fix (2026-09-25): use the combined signal (15s timeout + abort)
        // instead of the bare controller signal -- a stalled content request
        // previously hung until the finally-block abort, blocking the chain.
        signal,
      }, this.residentialProxyUrl);
      if (!transcriptResponse.ok) throw new Error(`Transcript content fetch failed: ${transcriptResponse.status}`);

      const captionData = await transcriptResponse.json() as {
        events?: Array<{ segs?: Array<{ utf8?: string }>, tStartMs?: number, dDurationMs?: number }>;
      };

      if (!captionData.events?.length) throw new Error('Empty transcript data');

      let cumulative = 0;
      const segments = captionData.events.map(event => {
        const segs = event.segs ?? [];
        const text = segs.map(seg => seg.utf8 || '').join('').replace(/\s+/g, ' ').trim();
        const start = typeof event.tStartMs === 'number' ? event.tStartMs / 1000 : cumulative * 3;
        const duration = typeof event.dDurationMs === 'number' ? event.dDurationMs / 1000 : 3;
        cumulative++;
        return { start, duration, text };
      }).filter(segment => segment.text.length > 0)
        .filter(segment => {
          return !isNaN(segment.start) && !isNaN(segment.duration) && segment.start >= 0 && segment.duration > 0 && segment.start < 86400;
        });

      const transcript = segments.map(segment => segment.text).join(' ').replace(/\s+/g, ' ').trim();

      if (!transcript) throw new Error('Empty transcript after processing');

      return { videoId, transcript, language: langCode, segments };
    } catch (err) {
      console.warn(`[transcript] Page HTML parse for ${videoId}: ${err instanceof Error ? err.message : String(err)}`);
      captureException(err, { tags: { operation: 'transcript-page-html', videoId } });
      throw err;
    } finally {
      controller.abort();
    }
  }

  /** Fetches the timedtext caption-track list and picks the preferred track's language. */
  private async fetchCaptionMetadata(videoId: string): Promise<{ langCode: string }> {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
    try {
      const metadataUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&type=list`;
      const response = await fetchWithProxy(metadataUrl, {
        headers: { 'User-Agent': getRandomUserAgent() },
        signal,
      }, this.residentialProxyUrl);
      if (!response.ok) throw new Error(`Caption metadata fetch failed: ${response.status}`);
      const metadataText = await response.text();

      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
      });

      let parsed: { transcript_list?: { track?: unknown } };
      try {
        parsed = parser.parse(metadataText);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[transcript] XML parse failed for ${videoId}: ${msg}`);
        captureException(err, { tags: { operation: 'transcript-xml-parse', videoId } });
        throw new Error('Failed to parse caption metadata XML');
      }

      const tracks = parsed.transcript_list?.track;
      if (!tracks) throw new NoCaptionsConfirmedError('No captions available for this video');

      const trackList = Array.isArray(tracks) ? tracks : [tracks];

      const langCode = (track: Record<string, unknown>): string | undefined =>
        typeof track['@_lang_code'] === 'string' ? track['@_lang_code'] : undefined;

      const asrEn = trackList.find((track: Record<string, unknown>) =>
        typeof track === 'object' && langCode(track) === 'en' && track['@_kind'] === 'asr'
      );
      if (asrEn) return { langCode: 'en' };

      const en = trackList.find((track: Record<string, unknown>) =>
        typeof track === 'object' && langCode(track)?.startsWith('en')
      );
      if (en) return { langCode: langCode(en)! };

      const asr = trackList.find((track: Record<string, unknown>) =>
        typeof track === 'object' && track['@_kind'] === 'asr' && langCode(track)
      );
      if (asr) return { langCode: langCode(asr)! };

      const first = trackList.find((track): track is Record<string, unknown> => typeof track === 'object' && !!langCode(track));
      if (first) return { langCode: langCode(first)! };

      throw new NoCaptionsConfirmedError('No captions available for this video');
    } finally {
      controller.abort();
    }
  }

  /** Downloads the timedtext transcript content for `langCode` as JSON and joins the segment texts. */
  async fetchTranscriptContent(videoId: string, langCode: string): Promise<string> {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
    try {
      const transcriptUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${langCode}&fmt=json`;
      const response = await fetchWithProxy(transcriptUrl, {
        headers: { 'User-Agent': getRandomUserAgent() },
        signal,
      }, this.residentialProxyUrl);
      if (!response.ok) throw new Error(`Transcript content fetch failed: ${response.status}`);

      const captionData = (await response.json()) as {
        events?: Array<{
          segs?: Array<{ utf8?: string }>
        }>
      };

      if (!captionData.events || captionData.events.length === 0) {
        throw new Error('Transcript data structure empty');
      }

      const transcript = captionData.events
        .map(event => event.segs?.map(seg => seg.utf8 || '').join('') || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      return transcript;
    } catch (err) {
      console.warn(`[transcript] Transcript content fetch for ${videoId}: ${err instanceof Error ? err.message : String(err)}`);
      captureException(err, { tags: { operation: 'transcript-content-fetch', videoId } });
      throw err;
    } finally {
      controller.abort();
    }
  }
}