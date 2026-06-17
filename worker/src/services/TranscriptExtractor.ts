/**
 * TranscriptExtractor - Adapter implementing TranscriptProviderPort
 *
 * Implements 3-tier fallback chain:
 * 1. Primary: YouTube Native
 * 2. Secondary: Decodo API
 * 3. Tertiary: Placeholder/Fallback
 */

import { XMLParser } from 'fast-xml-parser';
import { fetchWithProxy } from './http-utils';
import { getRandomUserAgent } from './user-agent';
import type { TranscriptProviderPort, TranscriptResult } from '../ports/TranscriptProviderPort';

export class TranscriptExtractor implements TranscriptProviderPort {
  private residentialProxyUrl?: string;

  constructor(residentialProxyUrl?: string) {
    this.residentialProxyUrl = residentialProxyUrl;
  }

  async fetch(videoId: string): Promise<TranscriptResult> {
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      throw new Error(`Invalid video ID format: ${videoId}`);
    }

    // Cascade 1: Primary (YouTube)
    try {
      return await this.fetchWithPrimary(videoId);
    } catch (e) {
      console.warn(`[TranscriptExtractor] Primary fetch failed for ${videoId}: ${e instanceof Error ? e.message : 'Unknown'}`);
    }

    // Cascade 2: Decodo API
    try {
      console.info(`[TranscriptExtractor] Trying Decodo for ${videoId}...`);
      return await this.fetchWithDecodo(videoId);
    } catch (e) {
      console.warn(`[TranscriptExtractor] Decodo fetch failed for ${videoId}: ${e instanceof Error ? e.message : 'Unknown'}`);
    }

    // Cascade 3: Tertiary Fallback
    console.info(`[TranscriptExtractor] Trying Tertiary for ${videoId}...`);
    return await this.fetchWithTertiary(videoId);
  }

  private async fetchWithPrimary(videoId: string): Promise<TranscriptResult> {
    const { langCode } = await this.fetchCaptionMetadata(videoId);
    const transcript = await this.fetchTranscriptContent(videoId, langCode);
    if (!transcript) throw new Error('Empty');
    return { videoId, transcript, language: langCode };
  }

  private async fetchWithDecodo(videoId: string): Promise<TranscriptResult> {
    // Placeholder URL for Decodo - must be replaced with real configuration
    const decodoUrl = `https://api.decodo.com/v1/transcript/${videoId}`;
    const response = await fetch(decodoUrl);
    if (!response.ok) throw new Error('Decodo fail');
    const data = await response.json() as { transcript: string; lang: string };
    if (!data.transcript) throw new Error('Empty');
    return { videoId, transcript: data.transcript, language: data.lang };
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

    // Prioritize ASR English, then English, then first ASR, then first available
    const asrEn = trackList.find((t: Record<string, unknown>) =>
      typeof t === 'object' && t['@_lang_code'] === 'en' && t['@_kind'] === 'asr'
    );
    if (asrEn) return { langCode: 'en' };

    const en = trackList.find((t: Record<string, unknown>) =>
      typeof t === 'object' && (t['@_lang_code'] as string)?.startsWith('en')
    );
    if (en) return { langCode: (en as Record<string, string>)['@_lang_code'] };

    const asr = trackList.find((t: Record<string, unknown>) =>
      typeof t === 'object' && t['@_kind'] === 'asr'
    );
    if (asr) return { langCode: (asr as Record<string, string>)['@_lang_code'] };

    const first = trackList[0] as Record<string, string> | undefined;
    if (first?.['@_lang_code']) return { langCode: first['@_lang_code'] };

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
