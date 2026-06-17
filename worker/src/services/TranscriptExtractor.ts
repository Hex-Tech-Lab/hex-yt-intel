/**
 * TranscriptExtractor - Adapter implementing TranscriptProviderPort
 *
 * Implements 3-tier fallback chain:
 * 1. Primary: YouTube Native
 * 2. Secondary: Decodo API
 * 3. Tertiary: Placeholder/Fallback
 */

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
    
    // Improved regex to handle various XML formats
    const langCodeRegex = /lang_code="([^"]+)"/g;
    const matches = Array.from(metadataText.matchAll(langCodeRegex));
    
    if (matches.length === 0) {
      // Fallback: check for asr (automated speech recognition)
      if (metadataText.includes('kind="asr"')) {
        const asrMatch = metadataText.match(/lang_code="([^"]+)"[^>]*kind="asr"/);
        if (asrMatch) return { langCode: asrMatch[1] };
      }
      throw new Error('No captions available for this video');
    }
    
    // Prioritize English, then first available
    const langCode = matches.find((m) => m[1].startsWith('en'))?.[1] || matches[0][1];
    return { langCode };
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
