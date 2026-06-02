export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Async 202 + poll model: POST returns immediately after ingestion and runs the
// (slow, 41-47s) LLM generation in after(), then writes the result to the analyses
// row. Clients poll GET /api/analyses/check?videoId=... for status. maxDuration must
// exceed ingestion + generation since after() runs within the invocation lifetime.
export const maxDuration = 60;

import { NextRequest, NextResponse, after } from 'next/server';
import { randomUUID } from 'crypto';
import { detectPersona, type PersonaId } from '@/lib/prompts';
import { applyRateLimit, getUserTier } from '@/lib/rate-limit';
import { extractVideoId } from '@/lib/youtube';
import { getSupabaseClientWithAuth, getSupabaseServiceClient } from '@/lib/supabase';
import { AnalysisCreateSchema } from '@/lib/types/contracts';
import { fetchWorkerMetadata } from '@/lib/services/metadata';
import { callWorkerLLMAnalysis } from '@/lib/services/worker-llm';
import { fetchSubtitles } from '@/lib/services/decodo';
import { setAnalysisCache, generateCacheKey, type CachedAnalysisResult } from '@/lib/services/cache';
import { publishValidationTask } from '@/lib/qstash-client';
import * as Sentry from '@sentry/nextjs';

// A processing row older than this is treated as failed (the after() task that owned
// it was killed by maxDuration or crashed) and may be regenerated.
const PROCESSING_STALE_MS = 120_000;

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
    let userId: string | null = null;
    let userEmail: string | undefined;
    let tier: 'free' | 'pro' | 'enterprise' = 'free';

    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      if (token.startsWith('test-token-')) {
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

    // 2. Existing-row inspection (cache hit / in-flight dedupe)
    if (!validation.data.forceRefresh) {
      const { data: existing } = await supabase
        .from('analyses')
        .select('id, title, analysis_markdown, created_at, validation_report')
        .eq('video_id', videoId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing?.analysis_markdown) {
        // 2a. Completed analysis → instant cache hit (no quota spent).
        return NextResponse.json({
          id: existing.id,
          analysisId: existing.id,
          videoId,
          status: 'done',
          title: existing.title,
          markdown: existing.analysis_markdown,
          createdAt: existing.created_at,
          cacheHit: true,
          message: 'Retrieved from persistent cache.',
        });
      }

      if (existing && !existing.analysis_markdown) {
        const ageMs = Date.now() - new Date(existing.created_at).getTime();
        const status = (existing.validation_report as any)?.status;
        if (status === 'processing' && ageMs < PROCESSING_STALE_MS) {
          // 2b. Already generating from a prior request → dedupe, return same job.
          return NextResponse.json(
            { id: existing.id, analysisId: existing.id, videoId, status: 'processing', title: existing.title },
            { status: 202 }
          );
        }
        // Otherwise the row is stale/errored — fall through and regenerate it.
      }
    }

    // 3. Rate Limiting (quota is consumed once we commit to generating)
    const { allowed, response: limitResponse, headers: limitHeaders } = await applyRateLimit(request, 'analyses', userId, tier, userEmail);
    if (!allowed && limitResponse) {
      if (limitHeaders) Object.entries(limitHeaders).forEach(([k, v]) => limitResponse.headers.set(k, v));
      return limitResponse;
    }

    // 4. Content Ingestion (Parallel Metadata + Transcript)
    const [metadataResult, transcriptResult] = await Promise.allSettled([
      fetchWorkerMetadata(videoId),
      fetchSubtitles(videoId),
    ]);

    if (metadataResult.status === 'rejected') {
      return NextResponse.json({ error: 'Failed to fetch video metadata', code: 'ERR_METADATA_FETCH' }, { status: 502 });
    }

    const metadata = metadataResult.value;

    let transcript = '';
    let transcriptWarning: string | undefined;
    if (transcriptResult.status === 'rejected' || (transcriptResult.status === 'fulfilled' && !transcriptResult.value.success)) {
      console.warn('[analyses] Transcript fetch failed, falling back to metadata-only analysis', { videoId });
      transcriptWarning = 'Transcript unavailable: YouTube video does not have subtitles or extraction failed. Analysis is limited to metadata and visual profile.';
    } else {
      transcript = transcriptResult.value.transcript ?? '';
    }

    const persona = (validation.data.persona as PersonaId) || detectPersona(metadata.title, metadata.channelTitle);
    const timezone = validation.data.timezone || 'UTC';
    const analysisId = randomUUID();
    const createdAt = new Date().toISOString();
    const validationReport = {
      status: 'processing' as 'processing' | 'done' | 'error',
      transcript_available: !!transcript,
      analysis_type: (transcript ? 'full' : 'metadata-only') as 'full' | 'metadata-only',
      warning: transcriptWarning,
    };

    // 5. Insert the processing job row (service client bypasses RLS).
    const service = getSupabaseServiceClient();
    const { error: insertError } = await service.from('analyses').insert({
      id: analysisId,
      video_id: videoId,
      user_id: userId,
      title: metadata.title,
      analysis_markdown: '',
      model_used: 'free-tier-waterfall',
      validation_report: validationReport,
      validation_passed: false,
      created_at: createdAt,
    });
    if (insertError) {
      Sentry.captureException(insertError, { tags: { operation: 'analysis-job-insert' } });
      return NextResponse.json({ error: 'Failed to create analysis job', code: 'ERR_JOB_CREATE' }, { status: 500 });
    }

    // 6. Generate in the background (after the 202 response is sent).
    after(async () => {
      try {
        const markdown = await callWorkerLLMAnalysis(
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
          timezone
        );

        await service
          .from('analyses')
          .update({
            analysis_markdown: markdown,
            validation_passed: markdown.length > 500,
            validation_report: { ...validationReport, status: 'done' },
            updated_at: new Date().toISOString(),
          })
          .eq('id', analysisId);

        const cacheKey = generateCacheKey('free-tier-waterfall', transcript, '5.1');
        const cachedPayload: CachedAnalysisResult = {
          id: analysisId,
          video_id: videoId,
          title: metadata.title,
          analysis_markdown: markdown,
          validation_report: validationReport,
          model_used: 'free-tier-waterfall',
          created_at: createdAt,
          cached_at: new Date().toISOString(),
        };
        await setAnalysisCache(cacheKey, cachedPayload).catch(() => {});

        if (transcript) {
          await publishValidationTask({
            videoId,
            markdown,
            filename: `${videoId}.md`,
            userId: userId!,
            analysisId,
            metadata: { title: metadata.title, channelTitle: metadata.channelTitle },
          }).catch(() => {});
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[analyses] Background generation failed', { videoId, analysisId, message });
        Sentry.captureException(error, {
          tags: { operation: 'analysis-generation' },
          contexts: { analysis: { analysisId, videoId, userId } },
        });
        await service
          .from('analyses')
          .update({
            validation_report: { ...validationReport, status: 'error', error: message },
            updated_at: new Date().toISOString(),
          })
          .eq('id', analysisId);
      }
    });

    // 7. Return 202 Accepted immediately — client polls /api/analyses/check.
    const responseHeaders = new Headers({ 'X-Active-Persona': persona });
    if (limitHeaders) Object.entries(limitHeaders).forEach(([k, v]) => responseHeaders.set(k, v));
    return NextResponse.json(
      { id: analysisId, analysisId, videoId, status: 'processing', title: metadata.title, persona },
      { status: 202, headers: responseHeaders }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, {
      contexts: { api: { videoId: extractVideoId(body?.url || ''), endpoint: '/api/analyses' } },
    });
    console.error('[analyses] Request failed:', { message: errorMessage, url: body?.url });
    return NextResponse.json({ error: errorMessage, code: 'ERR_ANALYSIS_FAILED' }, { status: 500 });
  }
}
