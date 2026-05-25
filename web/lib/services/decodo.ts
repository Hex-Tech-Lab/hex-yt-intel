import { env } from '@/lib/env';

export interface DecodoResponse {
  success: boolean;
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
 * Fetch subtitles/transcript from a YouTube video using Decodo API.
 * Sends a REST POST request to Decodo's youtube_subtitles endpoint.
 *
 * @param videoId - The YouTube video ID
 * @returns Promise<TranscriptResponse> with transcript data or error reason
 */
export async function fetchSubtitles(videoId: string): Promise<TranscriptResponse> {
  const apiKey = env.decodoApiKey;

  console.log(`[DecodoAdapter] API key configured: ${apiKey ? 'yes' : 'no'}`);

  // Return early if API key not configured
  if (!apiKey) {
    return {
      success: false,
      reason: 'decodo_api_key_not_configured',
    };
  }

  try {
    // Encode API key for Basic auth if it contains a colon (username:password format)
    // Otherwise, treat it as a bearer token or direct API key
    let authHeader: string;
    if (apiKey.includes(':')) {
      // Already in username:password format, just base64 encode
      const encoded = btoa(apiKey);
      authHeader = `Basic ${encoded}`;
    } else {
      // Check if it looks like already base64 encoded (roughly)
      // If it starts with uppercase letters and contains = or is longer than 50 chars, assume base64
      if (/^[A-Za-z0-9+/=]+$/.test(apiKey) && (apiKey.includes('=') || apiKey.length > 50)) {
        // Already looks like base64, use as-is
        authHeader = `Basic ${apiKey}`;
      } else {
        // Use as bearer token
        authHeader = `Bearer ${apiKey}`;
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const payload = {
      target: 'youtube_subtitles',
      url: youtubeUrl,
    };
    console.log('[fetchSubtitles] DEBUG: Sending payload to Decodo:', JSON.stringify(payload));

    const response = await fetch('https://api.decodo.com/api/v1/youtube_subtitles', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // Handle 403 Forbidden (unauthorized)
    if (response.status === 403) {
      console.warn(`[fetchSubtitles] Decodo returned 403 Forbidden for video ${videoId}`);
      return {
        success: false,
        reason: 'unauthorized',
      };
    }

    // Handle other non-200 responses
    if (!response.ok) {
      console.warn(`[fetchSubtitles] Decodo returned ${response.status} for video ${videoId}`);
      return {
        success: false,
        reason: `http_${response.status}`,
      };
    }

    const data = (await response.json()) as DecodoResponse;

    // Check for error field in response
    if (data.error || !data.success) {
      console.warn(`[fetchSubtitles] Decodo error for ${videoId}:`, data.error);
      return {
        success: false,
        reason: data.error || 'decodo_error',
      };
    }

    // Extract transcript from response
    const transcript = data.data?.subtitles;

    if (!transcript || transcript.trim().length === 0) {
      console.warn(`[fetchSubtitles] Empty transcript for ${videoId}`);
      return {
        success: false,
        reason: 'empty_transcript',
      };
    }

    return {
      success: true,
      transcript: transcript.trim(),
      language: 'en', // Decodo typically returns English by default
      length: transcript.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    // Handle timeout
    if (message === 'The operation was aborted' || error instanceof Error && error.name === 'AbortError') {
      console.error(`[fetchSubtitles] Timeout fetching transcript for ${videoId}`);
      return {
        success: false,
        reason: 'timeout',
      };
    }

    console.error(`[fetchSubtitles] Error for ${videoId}:`, message);
    return {
      success: false,
      reason: 'request_failed',
    };
  }
}
