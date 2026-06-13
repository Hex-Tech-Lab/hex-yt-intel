export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { extractVideoId } from '@/lib/youtube';
import { fetchWorkerMetadata } from '@/lib/services/metadata';
import { AnalysisCreateSchema } from '@/lib/types/contracts';

interface MetadataResponse {
  videoId: string;
  title: string;
  channelTitle: string;
  channelId: string;
  publishedAt: string;
  duration: number | null;
  viewCount: string;
  likeCount: string;
  commentCount: string;
  thumbnailUrl: string | null;
  description?: string;
}

/** Fetch + shape video metadata for a resolved videoId. Throws on fetch failure. */
async function resolveMetadata(videoId: string): Promise<MetadataResponse> {
  const metadata = await fetchWorkerMetadata(videoId);
  return {
    videoId,
    title: metadata.title,
    channelTitle: metadata.channelTitle,
    channelId: metadata.channelId,
    publishedAt: metadata.publishedAt,
    duration: metadata.duration,
    viewCount: metadata.viewCount,
    likeCount: metadata.likeCount,
    commentCount: metadata.commentCount,
    thumbnailUrl: metadata.thumbnailUrl,
    description: metadata.description,
  };
}

/**
 * GET /api/metadata?url=<youtube-url>  (or ?videoId=<id>)
 * Idempotent read used by health/verification checks and direct lookups. The
 * route previously exported POST only, so these GETs returned 405.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const urlParam = searchParams.get('url');
    const videoIdParam = searchParams.get('videoId');

    const videoId = videoIdParam || (urlParam ? extractVideoId(urlParam) : null);
    if (!videoId) {
      return NextResponse.json(
        { error: 'Provide a ?url= or ?videoId= query parameter' },
        { status: 400 }
      );
    }

    try {
      const result = await resolveMetadata(videoId);
      return NextResponse.json(result, { status: 200 });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  } catch (error) {
    console.error('[/api/metadata] GET Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = AnalysisCreateSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error.flatten() },
        { status: 400 }
      );
    }

    // 400: Invalid URL
    const videoId = extractVideoId(validation.data.url);
    if (!videoId) {
      return NextResponse.json(
        { error: 'Invalid YouTube URL' },
        { status: 400 }
      );
    }

    try {
      const result = await resolveMetadata(videoId);
      return NextResponse.json(result, { status: 200 });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return NextResponse.json(
        { error: message },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[/api/metadata] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
