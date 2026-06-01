export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse, after } from 'next/server';
import { AnalysisLifecycleService } from '@/lib/services/analysis-lifecycle';
import { detectPersona, type PersonaId } from '@/lib/prompts';
import { applyRateLimit, getUserTier } from '@/lib/rate-limit';
import { extractVideoId } from '@/lib/youtube';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { AnalysisCreateSchema } from '@/lib/schemas';
import { fetchWorkerMetadata } from '@/lib/worker-client';
import { callOpenRouter } from '@/lib/services/openrouter';
import { fetchSubtitles } from '@/lib/services/decodo';
import { createClaudeStreamNormalizer } from '@/lib/streaming';
import * as Sentry from '@sentry/nextjs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = AnalysisCreateSchema.safeParse(body);
    
    if (!validation.success) {
      return NextResponse.json({ error: 'Invalid request', details: validation.error.flatten() }, { status: 400 });
    }

    const videoId = extractVideoId(validation.data.url);
    if (!videoId) {
      return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });
    }

    // 1. Authentication & Tier Identification
    const supabase = await getSupabaseClientWithAuth();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = user.id;
    const tier = (await getUserTier(userId)) ?? 'free';

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
    const transcript = transcriptResult.status === 'fulfilled' && transcriptResult.value.success 
      ? transcriptResult.value.transcript ?? '' 
      : '';

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
          transcriptWarning: transcript ? undefined : 'Analysis limited to metadata',
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
    Sentry.captureException(error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
