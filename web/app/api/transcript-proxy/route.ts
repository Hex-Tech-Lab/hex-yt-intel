export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { fetchSubtitles } from '@/lib/services/decodo';
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

/**
 * Transcript proxy endpoint using Decodo REST API.
 * Accepts either a YouTube URL or videoId and returns transcript data.
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

    // Fetch transcript from Decodo
    const result = await fetchSubtitles(videoId);

    if (!result.success) {
      // Return error response with reason
      if (result.reason === 'unauthorized') {
        return NextResponse.json(
          {
            success: false,
            error: 'Decodo authorization failed',
            reason: 'unauthorized',
          },
          { status: 403 }
        );
      }

      if (result.reason === 'timeout') {
        return NextResponse.json(
          {
            success: false,
            error: 'Transcript fetch timeout',
            reason: 'timeout',
          },
          { status: 504 }
        );
      }

      // For other errors, return 404 or 500 depending on type
      const statusCode = result.reason?.startsWith('http_') ? 502 : 500;
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to fetch transcript',
          reason: result.reason,
        },
        { status: statusCode }
      );
    }

    // Success response
    return NextResponse.json(
      {
        success: true,
        transcript: result.transcript,
        language: result.language,
        length: result.length,
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
    console.error('[/api/transcript-proxy] Error:', message);

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
