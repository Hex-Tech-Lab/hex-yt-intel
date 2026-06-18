/**
 * TranscriptExtractor - Adapter implementing TranscriptProviderPort
 *
 * Implements 3-tier fallback chain:
 * 1. Primary: Decodo API
 * 2. Secondary: YouTube Native
 * 3. Tertiary: Placeholder/Fallback
 */

import { XMLParser } from 'fast-xml-parser';
import { fetchWithProxy } from './http-utils';
import { getRandomUserAgent } from './user-agent';
import type { TranscriptProviderPort, TranscriptResult } from '../ports/TranscriptProviderPort';

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

    // Cascade 1: Decodo API (primary)
    if (this.decodoApiKey) {
      try {
        console.info(`[TranscriptExtractor] Trying Decodo for ${videoId}...`);
        return await this.fetchWithDecodo(videoId);
      } catch (e) {
        console.warn(`[TranscriptExtractor] Decodo failed for ${videoId}: ${e instanceof Error ? e.message : 'Unknown'}`);
      }
    } else {
      console.warn(`[TranscriptExtractor] Decodo API key not configured, skipping`);
    }

    // Cascade 2: YouTube Native (fallback)
    try {
      return await this.fetchWithYouTubeNative(videoId);
    } catch (e) {
      console.warn(`[TranscriptExtractor] YouTube fetch failed for ${videoId}: ${e instanceof Error ? e.message : 'Unknown'}`);
    }

    // Cascade 3: Tertiary Fallback
    console.info(`[TranscriptExtractor] Trying Tertiary for ${videoId}...`);
    return await this.fetchWithTertiary(videoId);
  }

  private async fetchWithYouTubeNative(videoId: string): Promise<TranscriptResult> {
    // Try the standard API first
    try {
      const { langCode } = await this.fetchCaptionMetadata(videoId);
      const transcript = await this.fetchTranscriptContent(videoId, langCode);
      if (transcript) return { videoId, transcript, language: langCode };
    } catch (e) {
      console.warn(`[TranscriptExtractor] Standard API failed for ${videoId}: ${e instanceof Error ? e.message : 'Unknown'}`);
    }

    // Fallback: extract captions from YouTube page HTML
    return await this.fetchFromPageHTML(videoId);
  }

  private async fetchFromPageHTML(videoId: string): Promise<TranscriptResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const response = await fetchWithProxy(pageUrl, {
        headers: { 'User-Agent': getRandomUserAgent() },
      }, this.residentialProxyUrl);
      if (!response.ok) throw new Error(`Page fetch failed: ${response.status}`);
      
      const html = await response.text();
      
      // Extract caption tracks from ytInitialPlayerResponse
      const captionMatch = html.match(/"captionTracks":\s*(\[.*?\])/);
      if (!captionMatch) throw new Error('No caption tracks found in page');
      
      const tracks = JSON.parse(captionMatch[1]) as Array<{
        baseUrl?: string;
        langCode?: string;
        kind?: string;
      }>;
      
      if (!tracks.length) throw new Error('Empty caption tracks');
      
      // Prioritize: ASR English > English > ASR > first available
      const asrEn = tracks.find(t => t.langCode === 'en' && t.kind === 'asr');
      const en = tracks.find(t => t.langCode?.startsWith('en'));
      const asr = tracks.find(t => t.kind === 'asr' && t.langCode);
      const first = tracks[0];
      
      const chosen = asrEn || en || asr || first;
      if (!chosen?.baseUrl) throw new Error('No suitable caption track');
      
      const langCode = chosen.langCode || 'en';
      
      // Fetch the actual transcript content
      const transcriptUrl = chosen.baseUrl.includes('fmt=json')
        ? chosen.baseUrl
        : `${chosen.baseUrl}&fmt=json`;
      
      const transcriptResponse = await fetch(transcriptUrl, {
        headers: { 'User-Agent': getRandomUserAgent() },
      });
      if (!transcriptResponse.ok) throw new Error(`Transcript content fetch failed: ${transcriptResponse.status}`);
      
      const captionData = await transcriptResponse.json() as {
        events?: Array<{ segs?: Array<{ utf8?: string }> }>;
      };
      
      if (!captionData.events?.length) throw new Error('Empty transcript data');
      
      const transcript = captionData.events
        .map(e => e.segs?.map(s => s.utf8 || '').join('') || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (!transcript) throw new Error('Empty transcript after processing');
      
      return { videoId, transcript, language: langCode };
    } finally {
      clearTimeout(timeout);
    }
  }

  async fetchChannelMetadata(channelId: string): Promise<Record<string, unknown> | null> {
    if (!this.decodoApiKey) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(`https://api.decodo.com/v1/channel/${channelId}`, {
        signal: controller.signal,
        headers: { 'Authorization': `Bearer ${this.decodoApiKey}` },
      });
      if (!res.ok) return null;
      return await res.json() as Record<string, unknown>;
    } catch { return null; }
    finally { clearTimeout(timeout); }
  }

  private async fetchWithDecodo(videoId: string): Promise<TranscriptResult> {
    if (!this.decodoApiKey) throw new Error('Decodo API key not configured');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const decodoUrl = `https://api.decodo.com/v1/transcript/${videoId}`;
      const response = await fetch(decodoUrl, {
        signal: controller.signal,
        headers: { 'Authorization': `Bearer ${this.decodoApiKey}` },
      });
      if (!response.ok) throw new Error(`Decodo fail: ${response.status}`);
      const data = await response.json() as { transcript: string; lang: string };
      if (!data.transcript) throw new Error('Empty');
      return { videoId, transcript: data.transcript, language: data.lang };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchWithTertiary(videoId: string): Promise<TranscriptResult> {
    // Graceful fallback: return a placeholder transcript
    return { 
      videoId, 
      transcript: '[Transcript unavailable for this video - content ingestion failed across all available sources]', 
      language: 'en' 
    };
  }

  private async fetchCaptionMetadata(videoId: string): Promise<{ langCode: string }> {
    const metadataUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&type=list`;
    const response = await fetchWithProxy(metadataUrl, { headers: { 'User-Agent': getRandomUserAgent() } }, this.residentialProxyUrl);
    if (!response.ok) throw new Error(`Caption metadata fetch failed: ${response.status}`);
    const metadataText = await response.text();

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });

    let parsed: { transcript_list?: { track?: unknown } };
    try {
      parsed = parser.parse(metadataText);
    } catch {
      throw new Error('Failed to parse caption metadata XML');
    }

    const tracks = parsed.transcript_list?.track;
    if (!tracks) throw new Error('No captions available for this video');

    const trackList = Array.isArray(tracks) ? tracks : [tracks];

    const langCode = (t: Record<string, unknown>): string | undefined =>
      typeof t['@_lang_code'] === 'string' ? t['@_lang_code'] : undefined;

    // Prioritize ASR English, then English, then first ASR, then first available
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

    throw new Error('No captions available for this video');
  }

  private async fetchTranscriptContent(videoId: string, langCode: string): Promise<string> {
    const transcriptUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${langCode}&fmt=json`;
    const response = await fetchWithProxy(transcriptUrl, { headers: { 'User-Agent': getRandomUserAgent() } }, this.residentialProxyUrl);
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
  }
}
