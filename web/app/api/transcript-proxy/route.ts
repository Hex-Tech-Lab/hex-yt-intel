export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { extractVideoId } from '@/lib/youtube';
import { AnalysisCreateSchema } from '@/lib/schemas';
import { fetchSubtitles } from '@/lib/services/decodo';

interface TranscriptProxyResponse {
  success: boolean;
  transcript?: string;
  language?: string;
  length?: number;
  error?: string;
  reason?: string;
}

/**
 * Transcript proxy endpoint that delegates to Decodo service.
 * Accepts a YouTube URL and returns transcript data via Decodo API.
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

    console.log(`[transcript-proxy] Fetching transcript for video ${videoId} via Decodo`);

    const result = await fetchSubtitles(videoId);

    if (!result.success) {
      const statusCode = result.reason?.startsWith('http_') ? 502 : 404;
      return NextResponse.json(result, { status: statusCode });
    }

    return NextResponse.json(result, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
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
