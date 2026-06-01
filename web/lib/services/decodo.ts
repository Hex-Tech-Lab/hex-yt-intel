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
 * Safely coerce an unknown error/payload into a human-readable string.
 *
 * Decodo intermittently returns non-string `error` fields (objects/arrays) and
 * the fetch layer can throw non-Error values. Logging or storing those directly
 * is what produced the "[object Object]"/`undefined` entries seen in production
 * logs. This helper guarantees a stable, finite string for every input.
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
    // Decodo v2 API expects Basic auth header
    // The apiKey is already in base64-encoded format from the dashboard (username:password)
    const authHeader = `Basic ${apiKey}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const payload = {
      target: 'youtube_subtitles',
      query: videoId,
    };
    console.log('[fetchSubtitles] DEBUG: Sending payload to Decodo:', JSON.stringify(payload));

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

    // Read the raw body first so a non-JSON payload (HTML error page, empty body)
    // never throws an unhandled SyntaxError out of response.json().
    const rawBody = await response.text();
    let data: DecodoResponse;
    try {
      data = JSON.parse(rawBody) as DecodoResponse;
    } catch {
      console.warn(
        `[fetchSubtitles] Decodo returned non-JSON body for ${videoId}: ${rawBody.slice(0, 200)}`
      );
      return {
        success: false,
        reason: 'invalid_response',
      };
    }

    // Check for error field in response (may be a non-string payload at runtime).
    if (data.error || !data.success) {
      const reason = safeStringify(data.error ?? 'decodo_error');
      console.warn(`[fetchSubtitles] Decodo error for ${videoId}: ${reason}`);
      return {
        success: false,
        reason,
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
    const message = safeStringify(error);

    // Handle timeout (AbortError is thrown when the controller aborts)
    if (
      message === 'The operation was aborted' ||
      (error instanceof Error && error.name === 'AbortError')
    ) {
      console.error(`[fetchSubtitles] Timeout fetching transcript for ${videoId}`);
      return {
        success: false,
        reason: 'timeout',
      };
    }

    console.error(`[fetchSubtitles] Error for ${videoId}: ${message}`);
    return {
      success: false,
      reason: 'request_failed',
    };
  }
}
