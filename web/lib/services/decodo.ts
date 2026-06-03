import { env } from '@/lib/env';

export interface DecodoResponse {
  results?: Array<{
    content?: {
      auto_generated?: Record<string, { events: any[] }>;
      uploader_provided?: Record<string, { events: any[] }>;
    };
    status_code?: number;
    error?: any;
  }>;
  // Legacy fields for backward compatibility
  success?: boolean;
  error?: string;
  data?: {
    subtitles?: string;
    status?: string;
  };
}

export interface TranscriptResponse {
  success: boolean;
  transcript?: string;
  language?: string;
  length?: number;
  reason?: string;
}

/**
 * Safely coerce an unknown error/payload into a human-readable string.
 */
function safeStringify(value: unknown): string {
  if (value === null || value === undefined) return 'unknown';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message || value.name || 'Error';
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return String(value);
  }
}

/**
 * Extracts and flattens transcript text from Decodo's nested event structure.
 * Handles both uploader-provided and auto-generated subtitles.
 */
function parseDecodoTranscript(content: any): string | null {
  if (!content) return null;

  // Prefer uploader provided, then auto-generated
  const sources = [content.uploader_provided, content.auto_generated];
  
  for (const source of sources) {
    if (!source) continue;
    
    // Find the first available language (usually 'en')
    const languages = Object.keys(source);
    if (languages.length === 0) continue;
    
    // Prefer 'en' if multiple exist
    const langKey = source['en'] ? 'en' : languages[0];
    if (!langKey) continue;

    const events = source[langKey]?.events;
    
    if (Array.isArray(events)) {
      return events
        .map(event => {
          if (!event.segs) return '';
          return event.segs.map((s: any) => s.utf8 || '').join('');
        })
        .join(' ')
        .replace(/\n+/g, ' ')
        .replace(/\s\s+/g, ' ')
        .trim();
    }
  }

  return null;
}

/**
 * Fetch subtitles/transcript from a YouTube video using Decodo API.
 * 
 * @param videoId - The YouTube video ID
 * @returns Promise<TranscriptResponse> with transcript data or error reason
 */
export async function fetchSubtitles(videoId: string): Promise<TranscriptResponse> {
  const apiKey = env.decodoApiKey;

  if (!apiKey) {
    return { success: false, reason: 'decodo_api_key_not_configured' };
  }

  try {
    const authHeader = `Basic ${apiKey}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // Increased to 15s for edge cases

    const payload = {
      target: 'youtube_subtitles',
      query: videoId,
    };

    const response = await fetch('https://scraper-api.decodo.com/v2/scrape', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.status === 403) {
      return { success: false, reason: 'unauthorized' };
    }

    if (!response.ok) {
      return { success: false, reason: `http_${response.status}` };
    }

    const rawBody = await response.text();
    let data: DecodoResponse;
    
    try {
      data = JSON.parse(rawBody) as DecodoResponse;
    } catch {
      return { success: false, reason: 'invalid_response' };
    }

    // Handle v2 results array format
    if (data.results && Array.isArray(data.results) && data.results.length > 0) {
      const result = data.results[0];
      
      if (!result) {
        return { success: false, reason: 'empty_results_item' };
      }

      if (result.error) {
        return { success: false, reason: safeStringify(result.error) };
      }

      const transcript = parseDecodoTranscript(result.content);
      
      if (transcript && transcript.length > 0) {
        return {
          success: true,
          transcript,
          language: 'en',
          length: transcript.length,
        };
      }
    }

    // Legacy fallback (if API switches back or uses v1 format)
    if (data.data?.subtitles) {
      return {
        success: true,
        transcript: data.data.subtitles.trim(),
        language: 'en',
        length: data.data.subtitles.length,
      };
    }

    return { success: false, reason: 'empty_transcript' };
  } catch (error) {
    const message = safeStringify(error);
    if (message.includes('aborted') || (error instanceof Error && error.name === 'AbortError')) {
      return { success: false, reason: 'timeout' };
    }
    return { success: false, reason: 'request_failed' };
  }
}
