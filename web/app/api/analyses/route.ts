export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse, after } from 'next/server';
import { AnalysisLifecycleService } from '@/lib/services/analysis-lifecycle';
import { detectPersona, type PersonaId } from '@/lib/prompts';
import { applyRateLimit, getUserTier } from '@/lib/rate-limit';
import { extractVideoId } from '@/lib/youtube';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { AnalysisCreateSchema } from '@/lib/schemas';
import { fetchWorkerMetadata } from '@/lib/services/metadata';
import { callOpenRouter } from '@/lib/services/openrouter';
import { fetchSubtitles } from '@/lib/services/decodo';
import { createClaudeStreamNormalizer } from '@/lib/streaming';
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
      tier = (await getUserTier(userId)) ?? 'free';
    }

    // 2. Rate Limiting
    const { allowed, response: limitResponse, headers: limitHeaders } = await applyRateLimit(request, 'analyses', userId, tier);
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

    // Graceful Degradation: If transcript fetch fails, return 200 OK immediately with metadata-only validation_report
    if (transcriptResult.status === 'rejected' || (transcriptResult.status === 'fulfilled' && !transcriptResult.value.success)) {
      console.warn('[analyses] Transcript fetch failed, returning 200 OK with metadata fallback', { videoId });
      return NextResponse.json({
        id: `meta-${videoId}`,
        title: metadata.title,
        markdown: `### DIMENSION 1 – METADATA_ONLY\nAnalysis is limited to video metadata because the transcript is unavailable. Title: ${metadata.title}\n\n### DIMENSION 10 – RISK_ASSESSMENT\nSYSTEM_STATE: DEGRADED (TRANSCRIPT_UNAVAILABLE)`,
        validation_report: { transcript_available: false, warning: 'Transcript unavailable: YouTube video does not have subtitles or extraction failed.' }
      }, { status: 200 });
    }

    const transcript = transcriptResult.value.transcript ?? '';

    // 5. Analysis Generation (OpenRouter Waterfall)
    const persona = (validation.data.persona as PersonaId) || detectPersona(metadata.title, metadata.channelTitle);
    const openrouterResponse = await callOpenRouter(metadata, transcript, persona, validation.data.timezone || 'UTC', metadata.duration || 0);

    // 6. Response Streaming & Background Orchestration
    const transformedStream = openrouterResponse.body!.pipeThrough(createClaudeStreamNormalizer());
    const [clientStream, processorStream] = transformedStream.tee();

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
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';

    Sentry.captureException(error, {
      contexts: {
        api: {
          videoId: extractVideoId(body?.url || ''),
          endpoint: '/api/analyses',
        },
      },
    });

    console.error('[analyses] Unhandled error:', {
      message: errorMessage,
      stack: errorStack,
      url: body?.url,
    });

    return NextResponse.json(
      {
        error: 'Analysis failed',
        message: errorMessage,
        ...(process.env.NODE_ENV !== 'production' && { stack: errorStack }),
      },
      { status: 500 }
    );
  }
}
