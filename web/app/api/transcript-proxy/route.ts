export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { extractVideoId } from '@/lib/youtube';
import { AnalysisCreateSchema } from '@/lib/schemas';

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

    // Fetch caption tracks metadata
    const metadataUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&type=list`;
    const metadataController = new AbortController();
    const metadataTimeout = setTimeout(() => metadataController.abort(), 5000);

    const metadataResponse = await fetch(metadataUrl, {
      signal: metadataController.signal,
      headers: { 'User-Agent': getRandomUserAgent() },
    });
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

    const transcriptResponse = await fetch(transcriptUrl, {
      signal: transcriptController.signal,
      headers: { 'User-Agent': getRandomUserAgent() },
    });
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
