export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse, after } from 'next/server';
import { AnalysisLifecycleService } from '@/lib/services/analysis-lifecycle';
import { detectPersona, type PersonaId } from '@/lib/prompts';
import { applyRateLimit, getUserTier } from '@/lib/rate-limit';
import { extractVideoId } from '@/lib/youtube';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { AnalysisCreateSchema } from '@/lib/types/contracts';
import { fetchWorkerMetadata } from '@/lib/services/metadata';
import { callWorkerLLMAnalysis } from '@/lib/services/worker-llm';
import { fetchSubtitles } from '@/lib/services/decodo';
import * as Sentry from '@sentry/nextjs';

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
    const validation = AnalysisCreateSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({ error: 'Invalid request', details: validation.error.flatten() }, { status: 400 });
    }

    const videoId = extractVideoId(validation.data.url);
    if (!videoId) {
      return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });
    }

    // 1. Authentication & Tier Identification
    // Development bypass for test bearer tokens (matches middleware pattern)
    let userId: string | null = null;
    let userEmail: string | undefined;
    let tier: 'free' | 'pro' | 'enterprise' = 'free';

    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      if (token.startsWith('test-token-')) {
        // Use hardcoded test user ID for development and verification
        userId = 'da4381c6-f774-4c99-8f04-2c1c9e27d1fb';
        tier = 'free';
      }
    }

    const supabase = await getSupabaseClientWithAuth();

    if (!userId) {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      userId = user.id;
      userEmail = user.email;
      tier = (await getUserTier(userId)) ?? 'free';
    }

    // 2. Rate Limiting
    const { allowed, response: limitResponse, headers: limitHeaders } = await applyRateLimit(request, 'analyses', userId, tier, userEmail);
    if (!allowed && limitResponse) {
      if (limitHeaders) Object.entries(limitHeaders).forEach(([k, v]) => limitResponse.headers.set(k, v));
      return limitResponse;
    }

    // 3. Cache Hit Check (Fast Path)
    if (!validation.data.forceRefresh) {
      const { data: cachedAnalysis } = await supabase
        .from('analyses')
        .select('id, title, analysis_markdown, created_at')
        .eq('video_id', videoId)
        .eq('user_id', userId)
        .maybeSingle();

      if (cachedAnalysis?.analysis_markdown) {
        return NextResponse.json({
          ...cachedAnalysis,
          cacheHit: true,
          message: 'Retrieved from persistent cache.'
        });
      }
    }

    // 4. Content Ingestion (Parallel Metadata + Transcript)
    const [metadataResult, transcriptResult] = await Promise.allSettled([
      fetchWorkerMetadata(videoId),
      fetchSubtitles(videoId)
    ]);

    if (metadataResult.status === 'rejected') {
      return NextResponse.json({ error: 'Failed to fetch video metadata' }, { status: 502 });
    }

    const metadata = metadataResult.value;

    // Graceful Degradation: If transcript fetch fails, proceed with metadata-only analysis
    let transcript = '';
    let transcriptWarning: string | undefined;

    if (transcriptResult.status === 'rejected' || (transcriptResult.status === 'fulfilled' && !transcriptResult.value.success)) {
      console.warn('[analyses] Transcript fetch failed, falling back to metadata-only analysis', { videoId });
      transcript = '';
      transcriptWarning = 'Transcript unavailable: YouTube video does not have subtitles or extraction failed. Analysis is limited to metadata and visual profile.';
    } else {
      transcript = transcriptResult.value.transcript ?? '';
    }

    // 5. Analysis Generation (Cloudflare Worker with 3-Model Cascade)
    const persona = (validation.data.persona as PersonaId) || detectPersona(metadata.title, metadata.channelTitle);
    const analysisMarkdown = await callWorkerLLMAnalysis(
      videoId,
      transcript,
      {
        title: metadata.title,
        channelTitle: metadata.channelTitle,
        publishedAt: metadata.publishedAt,
        duration: metadata.duration || 0,
        viewCount: String(metadata.viewCount),
        likeCount: String(metadata.likeCount),
        commentCount: String(metadata.commentCount),
      },
      persona,
      validation.data.timezone || 'UTC'
    );

    // 6. Response Streaming & Background Orchestration
    // Convert markdown analysis to SSE format for client streaming
    const encoder = new TextEncoder();
    const analysisStream = new ReadableStream<Uint8Array>({
      start(controller) {
        try {
          const sseEvent = `data: ${JSON.stringify({
            type: 'analysis_complete',
            content: analysisMarkdown,
          })}\n\n`;
          controller.enqueue(encoder.encode(sseEvent));
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    // Create a tee'd stream for background processing
    const [clientStream] = analysisStream.tee();
    const processorStream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue(analysisMarkdown);
        controller.close();
      },
    });

    after(() => {
      AnalysisLifecycleService.handleBackgroundTasks(
        {
          videoId,
          userId,
          metadata,
          transcript,
          persona,
          timezone: validation.data.timezone || 'UTC',
          transcriptWarning: transcriptWarning,
        },
        processorStream
      );
    });

    const responseHeaders = new Headers({
      'Content-Type': 'text/event-stream',
      'X-Active-Persona': persona,
    });
    if (limitHeaders) Object.entries(limitHeaders).forEach(([k, v]) => responseHeaders.set(k, v));

    return new Response(clientStream, { headers: responseHeaders });

  } catch (error) {
    // Worker LLM failures are returned as regular errors
    // Capture in Sentry and return HTTP error with message
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isWorkerError = errorMessage.includes('Worker') || errorMessage.includes('timeout');
    const statusCode = isWorkerError ? 502 : 500;

    Sentry.captureException(error, {
      contexts: {
        api: {
          videoId: extractVideoId(body?.url || ''),
          endpoint: '/api/analyses',
          workerError: isWorkerError,
        },
      },
    });

    console.error('[analyses] Analysis failed:', {
      message: errorMessage,
      status: statusCode,
      workerError: isWorkerError,
      url: body?.url,
    });

    return NextResponse.json(
      {
        error: errorMessage,
        code: isWorkerError ? 'ERR_WORKER_FAILURE' : 'ERR_ANALYSIS_FAILED',
      },
      { status: statusCode }
    );
  }
}
