import { getServerSession } from 'next-auth';
import { authConfig } from '@/lib/auth/nextauth-config';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { createUCISPrompt } from '@/lib/prompts';

interface AnalysisRequest {
  url: string;
}

interface AnalysisResponse {
  id: string;
  videoId: string;
  title: string;
  markdown: string;
  createdAt: string;
}

function extractVideoId(url: string): string | null {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname.includes('youtube.com')) {
      const id = urlObj.searchParams.get('v');
      if (id) return id;
    }
    if (urlObj.hostname.includes('youtu.be')) {
      const id = urlObj.pathname.slice(1);
      if (id) return id;
    }
    if (urlObj.pathname.startsWith('/embed/')) {
      const id = urlObj.pathname.split('/')[2];
      if (id) return id;
    }
    if (urlObj.pathname.startsWith('/v/')) {
      const id = urlObj.pathname.split('/')[2];
      if (id) return id;
    }
  } catch {
    return null;
  }
  return null;
}

async function fetchTranscript(videoId: string): Promise<string> {
  // MVP: Simple placeholder transcript
  // In production: fetch from YouTube API or caption service
  return `[Transcript for video ${videoId}]\n\nThis is a placeholder transcript. In production, this would be fetched from YouTube API captions or a transcription service.`;
}

async function callOpenRouter(
  metadata: {
    title: string;
    channelTitle: string;
    viewCount: string;
    likeCount: string;
    commentCount: string;
    publishedAt: string;
  },
  transcript: string
): Promise<string> {
  const prompt = createUCISPrompt(metadata, transcript);

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://hex-yt-intel.vercel.app',
      'X-Title': 'hex-yt-intel',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-haiku-4.5:free',
      messages: [
        {
          role: 'system',
          content: 'You are an expert YouTube content analyst. Generate a comprehensive 16-section content intelligence report in markdown format.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 4000,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Auth check
    const session = await getServerSession(authConfig);
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = (session.user as any).id;

    // 2. Parse request
    const body: AnalysisRequest = await request.json();
    if (!body.url) {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      );
    }

    // 3. Extract video ID
    const videoId = extractVideoId(body.url);
    if (!videoId) {
      return NextResponse.json(
        { error: 'Invalid YouTube URL' },
        { status: 400 }
      );
    }

    // 4. Supabase client (server-side)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // 5. Check free tier quota
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('tier, analyses_used')
      .eq('id', userId)
      .single();

    if (userError) {
      return NextResponse.json(
        { error: 'Failed to fetch user data' },
        { status: 500 }
      );
    }

    if (userData?.tier === 'free' && (userData?.analyses_used || 0) >= 3) {
      return NextResponse.json(
        { error: 'Monthly quota exceeded. Upgrade to Pro.' },
        { status: 402 }
      );
    }

    // 6. Fetch metadata from Worker
    const workerUrl = process.env.CLOUDFLARE_WORKER_URL || 'https://yt-intel.hex-tech-lab.workers.dev';
    const metadataUrl = `${workerUrl}/fetch-metadata?video_id=${videoId}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    let metadata: any;
    try {
      const response = await fetch(metadataUrl, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Worker returned ${response.status}`);
      }

      metadata = await response.json();
    } catch (error) {
      clearTimeout(timeout);
      return NextResponse.json(
        { error: 'Failed to fetch video metadata' },
        { status: 500 }
      );
    }

    // 7. Fetch transcript
    const transcript = await fetchTranscript(videoId);

    // 8. Call OpenRouter / Claude Haiku
    let markdown: string;
    try {
      markdown = await callOpenRouter(metadata, transcript);
    } catch (error) {
      console.error('[/api/analyses] OpenRouter error:', error);
      return NextResponse.json(
        { error: 'Failed to generate analysis' },
        { status: 500 }
      );
    }

    // 9. Insert analysis into Supabase
    const { data: analysis, error: insertError } = await supabase
      .from('analyses')
      .insert({
        user_id: userId,
        video_id: videoId,
        title: metadata.title || '',
        channel_title: metadata.channelTitle || '',
        view_count: parseInt(metadata.viewCount || '0', 10),
        markdown,
        embedding: null, // TODO: Generate embedding from markdown
        created_at: new Date().toISOString(),
      })
      .select('id, created_at')
      .single();

    if (insertError) {
      console.error('[/api/analyses] Insert error:', insertError);
      return NextResponse.json(
        { error: 'Failed to save analysis' },
        { status: 500 }
      );
    }

    // 10. Increment user counter
    const newCount = (userData?.analyses_used || 0) + 1;
    const { error: updateError } = await supabase
      .from('users')
      .update({ analyses_used: newCount })
      .eq('id', userId);

    if (updateError) {
      console.error('[/api/analyses] Update counter error:', updateError);
      // Non-fatal: analysis was saved, just counter update failed
    }

    // 11. Log usage
    await supabase.from('usage_logs').insert({
      user_id: userId,
      action: 'analysis_created',
      metadata: {
        video_id: videoId,
        analysis_id: analysis.id,
      },
      created_at: new Date().toISOString(),
    });

    // 12. Return response
    const result: AnalysisResponse = {
      id: analysis.id,
      videoId,
      title: metadata.title || '',
      markdown,
      createdAt: analysis.created_at,
    };

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('[/api/analyses] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
