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

export class YouTubeNativeTranscriptProvider implements TranscriptProviderPort {
  private residentialProxyUrl?: string;
  private decodoApiKey?: string;

  constructor(residentialProxyUrl?: string, decodoApiKey?: string) {
    this.residentialProxyUrl = residentialProxyUrl;
    this.decodoApiKey = decodoApiKey;
  }

  async fetch(videoId: string): Promise<TranscriptResult> {
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

  private async fetchFromPageHTML(videoId: string): Promise<TranscriptResult> {
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
      const asrPref = preferredLangs.map(l => tracks.find(t => t.langCode === l && t.kind === 'asr')).find(Boolean);
      const langPref = preferredLangs.map(l => tracks.find(t => t.langCode?.startsWith(l.split('-')[0]!))).find(Boolean);
      const asr = tracks.find(t => t.kind === 'asr' && t.langCode);
      const first = tracks[0];

      const chosen = asrPref || langPref || asr || first;
      if (!chosen?.baseUrl) throw new Error('No suitable caption track');

      const langCode = chosen.langCode || 'en';

      const transcriptUrl = chosen.baseUrl.includes('fmt=json')
        ? chosen.baseUrl
        : `${chosen.baseUrl}&fmt=json`;

      const transcriptResponse = await fetchWithProxy(transcriptUrl, {
        headers: { 'User-Agent': getRandomUserAgent() },
        signal: controller.signal,
      }, this.residentialProxyUrl);
      if (!transcriptResponse.ok) throw new Error(`Transcript content fetch failed: ${transcriptResponse.status}`);

      const captionData = await transcriptResponse.json() as {
        events?: Array<{ segs?: Array<{ utf8?: string }>, tStartMs?: number, dDurationMs?: number }>;
      };

      if (!captionData.events?.length) throw new Error('Empty transcript data');

      let cumulative = 0;
      const segments = captionData.events.filter(e => e.segs).map(e => {
        const text = e.segs!.map(s => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
        const start = typeof e.tStartMs === 'number' ? e.tStartMs / 1000 : cumulative * 3;
        const duration = typeof e.dDurationMs === 'number' ? e.dDurationMs / 1000 : 3;
        cumulative++;
        return { start, duration, text };
      }).filter(s => s.text.length > 0)
        .filter(s => {
          return !isNaN(s.start) && !isNaN(s.duration) && s.start >= 0 && s.duration > 0 && s.start < 86400;
        });

      const transcript = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();

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
        .map(e => e.segs?.map(s => s.utf8 || '').join('') || '')
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