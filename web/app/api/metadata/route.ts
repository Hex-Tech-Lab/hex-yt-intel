import { getServerSession } from 'next-auth';
import { authConfig } from '@/lib/auth/nextauth-config';
import { NextRequest, NextResponse } from 'next/server';
import { extractVideoId } from '@/lib/youtube';
import { fetchWorkerMetadata } from '@/lib/worker-client';

interface MetadataRequest {
  url: string;
}

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
}

export async function POST(request: NextRequest) {
  try {
    // 401: No auth
    const session = await getServerSession(authConfig);
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body: MetadataRequest = await request.json();

    if (!body.url) {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      );
    }

    // 400: Invalid URL
    const videoId = extractVideoId(body.url);
    if (!videoId) {
      return NextResponse.json(
        { error: 'Invalid YouTube URL' },
        { status: 400 }
      );
    }

    try {
      const metadata = await fetchWorkerMetadata(videoId);

      const result: MetadataResponse = {
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
      };

      return NextResponse.json(result, { status: 200 });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const statusCode = message.includes('timeout') ? 500 : 500;

      return NextResponse.json(
        { error: message },
        { status: statusCode }
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
