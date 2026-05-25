export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { extractVideoId } from '@/lib/youtube';
import { AnalysisCreateSchema } from '@/lib/schemas';
import { env } from '@/lib/env';

interface TranscriptProxyResponse {
  success: boolean;
  transcript?: string;
  language?: string;
  length?: number;
  error?: string;
  reason?: string;
}

// User-Agent rotation to bypass YouTube restrictions
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
];

const getRandomUserAgent = (): string => {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]!;
};

/**
 * Build proxied fetch URL and headers for residential proxy routing.
 * Routes requests through Bright Data residential proxy to bypass YouTube bot detection.
 */
const buildProxiedFetchInit = (
  targetUrl: string,
  proxyUrl: string | undefined,
  signal: AbortSignal,
): [string, RequestInit] => {
  const headers = {
    'User-Agent': getRandomUserAgent(),
  };

  // If no proxy configured, fetch directly from target URL
  if (!proxyUrl) {
    console.warn('[buildProxiedFetchInit] No proxy URL configured, falling back to direct fetch');
    return [targetUrl, { signal, headers }];
  }

  // Validate proxy URL format before use
  if (typeof proxyUrl !== 'string' || proxyUrl.length === 0) {
    console.warn('[buildProxiedFetchInit] Invalid proxy URL: must be non-empty string');
    return [targetUrl, { signal, headers }];
  }

  // Normalize proxy URL: prepend http:// if protocol is missing
  let normalizedProxyUrl = proxyUrl;
  if (!proxyUrl.startsWith('http://') && !proxyUrl.startsWith('https://')) {
    // Assume http:// for credentials-based proxies (Bright Data format)
    normalizedProxyUrl = `http://${proxyUrl}`;
    console.debug(`[buildProxiedFetchInit] Normalized proxy URL format (added http:// prefix)`);
  }

  // Route through residential proxy endpoint
  // For credential-based proxies, use HTTP proxy protocol (no query param needed)
  // The proxy will handle routing to the target URL automatically via the HTTP_PROXY mechanism
  const encodedTarget = encodeURIComponent(targetUrl);
  const proxiedUrl = `${normalizedProxyUrl}?url=${encodedTarget}`;
  console.log(`[buildProxiedFetchInit] Routing through proxy: ${normalizedProxyUrl}`);

  return [proxiedUrl, { signal, headers }];
};

/**
 * Transcript proxy endpoint using YouTube's native timedtext API.
 * Accepts a YouTube URL and returns transcript data.
 */
export async function POST(request: NextRequest): Promise<NextResponse<TranscriptProxyResponse>> {
  try {
    const body = await request.json();
    const validation = AnalysisCreateSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request',
          reason: 'validation_failed',
        },
        { status: 400 }
      );
    }

    // Extract video ID from URL
    const videoId = extractVideoId(validation.data.url);
    if (!videoId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid YouTube URL',
          reason: 'invalid_url',
        },
        { status: 400 }
      );
    }

    console.log(`[transcript-proxy] Fetching transcript for video ${videoId}`);

    // Get residential proxy URL from environment
    const proxyUrl = env.residentialProxyUrl;
    console.log(`[transcript-proxy] Residential proxy configured: ${proxyUrl ? 'yes' : 'no'}`);

    // Fetch caption tracks metadata
    const metadataUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&type=list`;
    const metadataController = new AbortController();
    const metadataTimeout = setTimeout(() => metadataController.abort(), 5000);

    const [proxiedMetadataUrl, metadataInit] = buildProxiedFetchInit(
      metadataUrl,
      proxyUrl,
      metadataController.signal,
    );

    const metadataResponse = await fetch(proxiedMetadataUrl, metadataInit);
    clearTimeout(metadataTimeout);

    if (!metadataResponse.ok) {
      console.warn(`[transcript-proxy] Caption metadata fetch failed for ${videoId}: ${metadataResponse.status}`);
      return NextResponse.json(
        {
          success: false,
          error: 'No transcript available for this video',
          reason: 'no_captions',
        },
        { status: 404 }
      );
    }

    const metadataText = await metadataResponse.text();

    // Parse XML response to find caption tracks
    const captionRegex = /lang_code="([^"]+)"/g;
    const matches = Array.from(metadataText.matchAll(captionRegex));

    if (matches.length === 0) {
      console.warn(`[transcript-proxy] No captions found for ${videoId}`);
      return NextResponse.json(
        {
          success: false,
          error: 'No captions available for this video',
          reason: 'no_captions',
        },
        { status: 404 }
      );
    }

    // Prioritize English, fallback to first available language
    let langCode = matches[0]?.[1] || 'en';
    const englishMatch = matches.find(m => m[1]?.startsWith('en'));
    if (englishMatch?.[1]) {
      langCode = englishMatch[1];
    }

    console.log(`[transcript-proxy] Using language: ${langCode}`);

    // Fetch the actual transcript
    const transcriptUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${langCode}&fmt=json`;
    const transcriptController = new AbortController();
    const transcriptTimeout = setTimeout(() => transcriptController.abort(), 5000);

    const [proxiedTranscriptUrl, transcriptInit] = buildProxiedFetchInit(
      transcriptUrl,
      proxyUrl,
      transcriptController.signal,
    );

    const transcriptResponse = await fetch(proxiedTranscriptUrl, transcriptInit);
    clearTimeout(transcriptTimeout);

    if (!transcriptResponse.ok) {
      console.warn(`[transcript-proxy] Transcript content fetch failed for ${videoId}: ${transcriptResponse.status}`);
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to fetch transcript content',
          reason: `http_${transcriptResponse.status}`,
        },
        { status: 500 }
      );
    }

    const captionData = (await transcriptResponse.json()) as {
      events?: Array<{ tStartMs?: string; dur?: string; segs?: Array<{ utf8?: string }> }>;
    };

    if (!captionData.events || !Array.isArray(captionData.events)) {
      console.warn(`[transcript-proxy] No transcript events for ${videoId}`);
      return NextResponse.json(
        {
          success: false,
          error: 'No transcript events found',
          reason: 'no_events',
        },
        { status: 404 }
      );
    }

    // Reconstruct transcript from events
    const transcript = captionData.events
      .filter((event) => event && Array.isArray(event.segs) && event.segs.length > 0)
      .map((event) => {
        return (event.segs || []).map((seg) => seg?.utf8 || '').join('');
      })
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (transcript.length === 0) {
      console.warn(`[transcript-proxy] Empty transcript after parsing for ${videoId}`);
      return NextResponse.json(
        {
          success: false,
          error: 'Transcript is empty',
          reason: 'empty_transcript',
        },
        { status: 404 }
      );
    }

    console.log(`[transcript-proxy] Successfully fetched ${transcript.length} characters for ${videoId}`);

    // Success response
    return NextResponse.json(
      {
        success: true,
        transcript,
        language: langCode,
        length: transcript.length,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, max-age=86400',
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message === 'The operation was aborted' || message === 'AbortError') {
      console.error(`[transcript-proxy] Timeout fetching transcript`);
      return NextResponse.json(
        {
          success: false,
          error: 'Transcript fetch timeout',
          reason: 'timeout',
        },
        { status: 504 }
      );
    }

    console.error('[transcript-proxy] Error:', message);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        reason: 'server_error',
      },
      { status: 500 }
    );
  }
}
