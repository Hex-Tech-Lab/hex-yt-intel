import { getServerSession } from 'next-auth';
import { authConfig } from '@/lib/auth/nextauth-config';
import { NextRequest, NextResponse } from 'next/server';

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

function extractVideoId(url: string): string | null {
  try {
    const urlObj = new URL(url);

    // youtube.com/watch?v=ID
    if (urlObj.hostname.includes('youtube.com')) {
      const id = urlObj.searchParams.get('v');
      if (id) return id;
    }

    // youtu.be/ID
    if (urlObj.hostname.includes('youtu.be')) {
      const id = urlObj.pathname.slice(1);
      if (id) return id;
    }

    // youtube.com/embed/ID
    if (urlObj.pathname.startsWith('/embed/')) {
      const id = urlObj.pathname.split('/')[2];
      if (id) return id;
    }

    // youtube.com/v/ID
    if (urlObj.pathname.startsWith('/v/')) {
      const id = urlObj.pathname.split('/')[2];
      if (id) return id;
    }
  } catch {
    return null;
  }

  return null;
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

    // Call Cloudflare Worker
    const workerUrl = process.env.CLOUDFLARE_WORKER_URL || 'https://yt-intel.hex-tech-lab.workers.dev';
    const metadataUrl = `${workerUrl}/fetch-metadata?video_id=${videoId}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000); // 3 second timeout

    try {
      const response = await fetch(metadataUrl, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Worker returned ${response.status}`);
      }

      const metadata = await response.json();

      const result: MetadataResponse = {
        videoId,
        title: metadata.title || '',
        channelTitle: metadata.channelTitle || '',
        channelId: metadata.channelId || '',
        publishedAt: metadata.publishedAt || '',
        duration: metadata.duration || null,
        viewCount: metadata.viewCount || '0',
        likeCount: metadata.likeCount || '0',
        commentCount: metadata.commentCount || '0',
        thumbnailUrl: metadata.thumbnailUrl || null,
      };

      return NextResponse.json(result, { status: 200 });
    } catch (error) {
      clearTimeout(timeout);

      if (error instanceof Error && error.name === 'AbortError') {
        return NextResponse.json(
          { error: 'Worker request timeout' },
          { status: 500 }
        );
      }

      return NextResponse.json(
        { error: 'Failed to fetch metadata from Worker' },
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
