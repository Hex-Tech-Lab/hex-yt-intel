/**
 * TranscriptExtractor - Adapter implementing TranscriptProviderPort
 * qa-intel: no stream state here to call settleAnalysis or setError
 *
 * Implements 3-tier fallback chain:
 * 1. Primary: Decodo API
 * 2. Secondary: YouTube Native
 * 3. Tertiary: Placeholder/Fallback
 */

import { XMLParser } from 'fast-xml-parser';
import { captureException, captureMessage } from '@sentry/cloudflare';
import { fetchWithProxy } from './http-utils';
import { getRandomUserAgent } from './user-agent';
import type { TranscriptProviderPort, TranscriptResult } from '../ports/TranscriptProviderPort';

/** Thrown only when a source affirmatively confirms zero caption tracks exist (see TranscriptResult.confirmedNoCaptions). */
class NoCaptionsConfirmedError extends Error {}

export class TranscriptExtractor implements TranscriptProviderPort {
  private residentialProxyUrl?: string;
  private decodoApiKey?: string;

  constructor(residentialProxyUrl?: string, decodoApiKey?: string) {
    this.residentialProxyUrl = residentialProxyUrl;
    this.decodoApiKey = decodoApiKey;
  }

  async fetch(videoId: string): Promise<TranscriptResult> {
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      throw new Error(`Invalid video ID format: ${videoId}`);
    }

    // Accumulates one entry per tier tried this run, so a single Sentry
    // event at the end can show the FULL picture ("Decodo: 429, standard
    // API: timeout, page HTML: no tracks found") instead of 3 separate,
    // hard-to-correlate exception events that each only know their own tier.
    const tierFailures: Array<{ tier: string; reason: string }> = [];

    if (this.decodoApiKey) {
      try {
        console.info(`[transcript] Trying Decodo for ${videoId}...`);
        return await this.fetchWithDecodo(videoId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[transcript] Decodo failed for ${videoId}: ${msg}`);
        captureException(e, { tags: { operation: 'transcript-decodo', videoId } });
        tierFailures.push({ tier: 'decodo', reason: msg });
      }
    } else {
      console.warn(`[transcript] Decodo API key not configured, skipping`);
      tierFailures.push({ tier: 'decodo', reason: 'not configured' });
    }

    let confirmedNoCaptions = false;
    try {
      return await this.fetchWithYouTubeNative(videoId, tierFailures);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[transcript] YouTube fetch failed for ${videoId}: ${msg}`);
      captureException(e, { tags: { operation: 'transcript-youtube-native', videoId } });
      confirmedNoCaptions = e instanceof NoCaptionsConfirmedError;
    }

    console.info(`[transcript] Trying Tertiary for ${videoId}...`);
    if (!confirmedNoCaptions) {
      // Every tier failed and none confirmed the video simply has no
      // captions -- this is the case that needs full RCA visibility, since
      // it means our pipeline (not the video) is the problem.
      captureMessage(`Transcript pipeline exhausted for ${videoId}`, {
        level: 'error',
        tags: { operation: 'transcript-pipeline-exhausted', videoId },
        extra: { tierFailures },
      });
    }
    return this.fetchWithTertiary(videoId, confirmedNoCaptions);
  }

  private async fetchWithYouTubeNative(videoId: string, tierFailures: Array<{ tier: string; reason: string }>): Promise<TranscriptResult> {
    let standardApiConfirmedNone = false;
    try {
      const { langCode } = await this.fetchCaptionMetadata(videoId);
      const transcript = await this.fetchTranscriptContent(videoId, langCode);
      if (transcript) return { videoId, transcript, language: langCode };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[transcript] Standard API failed for ${videoId}: ${msg}`);
      captureException(e, { tags: { operation: 'transcript-standard-api', videoId } });
      tierFailures.push({ tier: 'youtube-standard-api', reason: msg });
      standardApiConfirmedNone = e instanceof NoCaptionsConfirmedError;
    }

    try {
      return await this.fetchFromPageHTML(videoId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[transcript] Page HTML extraction failed for ${videoId}: ${msg}`);
      captureException(e, { tags: { operation: 'transcript-page-html-yt-native', videoId } });
      tierFailures.push({ tier: 'youtube-page-html', reason: msg });
      // Only confirm "no captions" when BOTH independent sources (YouTube's
      // caption-list API and the page's own ytInitialData) agree there are
      // none -- either one alone failing for an unrelated reason (network,
      // proxy, rate limit) must not produce a false "this video has no
      // captions" claim.
      if (standardApiConfirmedNone && e instanceof NoCaptionsConfirmedError) {
        throw new NoCaptionsConfirmedError(e.message);
      }
      throw e;
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
    } catch (e) {
      captureException(e, { tags: { operation: 'transcript-page-html', videoId } });
      throw e;
    } finally {
      controller.abort();
    }
  }

  async fetchChannelMetadata(channelId: string): Promise<Record<string, unknown> | null> {
    if (!this.decodoApiKey) return null;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
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
          target: 'youtube_channel',
          query: channelId,
          parse: true,
          limit: 1,
        }),
      }, this.residentialProxyUrl);
      if (!response.ok) {
        // RCA (2026-07-24): this branch returned null with zero logging --
        // same silent-swallow shape fixed in MetadataScraper.fetchComments
        // tonight (see that RCA). A non-2xx from Decodo (rate limit,
        // account issue, target-site block) was indistinguishable from
        // "this channel genuinely has no metadata."
        const bodyText = await response.text().catch(() => '');
        console.warn(`[transcript] Channel metadata fetch non-ok for ${channelId}: ${response.status} ${response.statusText}`, bodyText.slice(0, 300));
        captureMessage(`Channel metadata fetch non-ok: ${channelId}`, {
          level: 'warning',
          tags: { operation: 'transcript-channel-metadata', status: String(response.status) },
          extra: { channelId, status: response.status, body: bodyText.slice(0, 300) },
        });
        return null;
      }
      const data = await response.json() as { results?: Array<{ content?: unknown }> };
      return data.results?.[0]?.content as Record<string, unknown> ?? null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[transcript] Channel metadata fetch failed for ${channelId}: ${msg}`);
      captureException(e, { tags: { operation: 'transcript-channel-metadata', channelId } });
      return null;
    } finally { controller.abort(); }
  }

  private async fetchWithDecodo(videoId: string): Promise<TranscriptResult> {
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
    } catch (e) {
      throw e;
    } finally {
      controller.abort();
    }
  }

  private fetchWithTertiary(videoId: string, confirmedNoCaptions: boolean): TranscriptResult {
    return {
      videoId,
      transcript: confirmedNoCaptions
        ? '[No captions available for this video]'
        : '[Transcript unavailable for this video - content ingestion failed across all available sources]',
      language: 'en',
      confirmedNoCaptions,
    };
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
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[transcript] XML parse failed for ${videoId}: ${msg}`);
        captureException(e, { tags: { operation: 'transcript-xml-parse', videoId } });
        throw new Error('Failed to parse caption metadata XML');
      }

      const tracks = parsed.transcript_list?.track;
      if (!tracks) throw new NoCaptionsConfirmedError('No captions available for this video');

      const trackList = Array.isArray(tracks) ? tracks : [tracks];

      const langCode = (t: Record<string, unknown>): string | undefined =>
        typeof t['@_lang_code'] === 'string' ? t['@_lang_code'] : undefined;

      const asrEn = trackList.find((t: Record<string, unknown>) =>
        typeof t === 'object' && langCode(t) === 'en' && t['@_kind'] === 'asr'
      );
      if (asrEn) return { langCode: 'en' };

      const en = trackList.find((t: Record<string, unknown>) =>
        typeof t === 'object' && langCode(t)?.startsWith('en')
      );
      if (en) return { langCode: langCode(en)! };

      const asr = trackList.find((t: Record<string, unknown>) =>
        typeof t === 'object' && t['@_kind'] === 'asr' && langCode(t)
      );
      if (asr) return { langCode: langCode(asr)! };

      const first = trackList.find((t): t is Record<string, unknown> => typeof t === 'object' && !!langCode(t));
      if (first) return { langCode: langCode(first)! };

      throw new NoCaptionsConfirmedError('No captions available for this video');
    } catch (e) {
      throw e;
    } finally {
      controller.abort();
    }
  }

  private async fetchTranscriptContent(videoId: string, langCode: string): Promise<string> {
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
    } catch (e) {
      captureException(e, { tags: { operation: 'transcript-content-fetch', videoId } });
      throw e;
    } finally {
      controller.abort();
    }
  }
}
