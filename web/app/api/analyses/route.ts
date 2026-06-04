export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Bouncer only: auth + quota + ingestion + mint a streaming token, then return fast.
// The slow LLM generation streams directly browser<->Cloudflare Worker (no Vercel
// function in the LLM path), so the 60s Hobby ceiling never applies. ~8s typical.
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { detectPersona, type PersonaId } from '@/lib/prompts';
import { guardTraffic, getUserTier } from '@/lib/services/traffic';
import { chargeMonthlyQuota, refundMonthlyQuota } from '@/lib/services/billing';
import { extractVideoId } from '@/lib/youtube';
import { getSupabaseClientWithAuth, getSupabaseServiceClient } from '@/lib/supabase';
import { AnalysisCreateSchema, type AnalysisJobMetadata } from '@/lib/types/contracts';
import { fetchWorkerMetadata } from '@/lib/services/metadata';
import { fetchSubtitles } from '@/lib/services/decodo';
import { signStreamToken } from '@/lib/stream-token';
import * as Sentry from '@sentry/nextjs';

const PROCESSING_STALE_MS = 180_000;

export async function POST(request: NextRequest) {
  // Typed at the perimeter — no `any` enters the controller. Only `url` is read in the
  // catch handler for telemetry, so a minimal shape is sufficient and explicit.
  let body: { url?: string } | undefined;
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

    // 1. Auth & tier — STRICT tenant isolation. Identity is derived ONLY from the
    // verified Supabase session; there is no static/bearer test bypass on this route.
    // A forged token must never resolve to a real tenant's quota or data. (Dev/CI E2E
    // authenticates via the NODE_ENV-gated X-Hex-Test-Secret path in middleware.ts.)
    const supabase = await getSupabaseClientWithAuth();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId: string = user.id;
    const userEmail = user.email;
    const tier: 'free' | 'pro' | 'enterprise' = (await getUserTier(userId)) ?? 'free';

    // 2. Cache hit — must return the SAME contract shape as the fresh-job path so the
    // client treats both interchangeably. We pull validation_report to recover the
    // metadata persisted at job creation (see step 5), eliminating the prior gap where
    // cache hits returned no `metadata`/`persona`/`timezone` and the UI rendered blank.
    if (!validation.data.forceRefresh) {
      const { data: existing } = await supabase
        .from('analyses')
        .select('id, title, analysis_markdown, created_at, validation_report, validation_passed')
        .eq('video_id', videoId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing?.analysis_markdown) {
        const cachedReport = (existing.validation_report ?? {}) as { metadata?: AnalysisJobMetadata; persona?: string; timezone?: string };
        const cachedPersona = cachedReport.persona || 'analyst';

        // CRITICAL FIX: Shield against poisoned empty caches and failed validations
        // Only cache-hit on rows where: (1) markdown exists and is not empty, (2) validation_passed = true
        const hasMarkdown = existing.analysis_markdown.trim().length > 0;
        const isValidated = existing.validation_passed === true;

        if (!hasMarkdown || !isValidated) {
          console.warn(`[Bouncer] Poisoned cache detected for analysis ${existing.id}. Purging row and re-running.`, {
            hasMarkdown,
            isValidated
          });
          // Delete the corrupted row so the next step creates a fresh one
          await supabase.from('analyses').delete().eq('id', existing.id);
        } else {
          return NextResponse.json({
            id: existing.id,
            analysisId: existing.id,
            videoId,
            status: 'done',
            title: existing.title,
            markdown: existing.analysis_markdown,
            analysis_markdown: existing.analysis_markdown,
            createdAt: existing.created_at,
            analysisAt: existing.created_at,
            persona: cachedPersona,
            detectedPersona: cachedPersona,
            timezone: cachedReport.timezone || validation.data.timezone || 'UTC',
            // Restored from the persisted job context; absent only for legacy pre-contract rows.
            metadata: cachedReport.metadata,
            streaming: {
              started: existing.created_at,
              interrupted: false,
              dimensionsReceived: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
            },
            cacheHit: true,
            message: 'Retrieved from persistent cache.',
          });
        }
      }
    }

    // 3a. Traffic guard: per-minute rate limit (DDoS protection)
    const { allowed: trafficAllowed, response: trafficResponse, headers: trafficHeaders } = await guardTraffic(request, 'analyses', userId, tier, userEmail);
    if (!trafficAllowed && trafficResponse) {
      return trafficResponse;
    }

    // 3b. Billing charge: monthly quota enforcement
    const { allowed: quotaAllowed, response: quotaResponse } = await chargeMonthlyQuota(userId, tier, userEmail);
    if (!quotaAllowed && quotaResponse) {
      return quotaResponse;
    }

    // 4. Ingestion (parallel metadata + transcript)
    const [metadataResult, transcriptResult] = await Promise.allSettled([
      fetchWorkerMetadata(videoId),
      fetchSubtitles(videoId),
    ]);

    if (metadataResult.status === 'rejected') {
      // Quota was charged at step 3; ingestion failed before any generation ran. Refund it.
      await refundMonthlyQuota(userId, userEmail);
      return NextResponse.json({ error: 'Failed to fetch video metadata', code: 'ERR_METADATA_FETCH' }, { status: 502 });
    }
    const metadata = metadataResult.value;

    let transcript = '';
    if (transcriptResult.status === 'fulfilled' && transcriptResult.value.success) {
      transcript = transcriptResult.value.transcript ?? '';
    }

    if (!transcript || transcript.trim().length === 0) {
      console.warn('[analyses] Empty transcript, halting analysis', { videoId });
      // Transcript Absolutism: no usable source means no analysis can run. The quota
      // unit charged at step 3 must be refunded so a subtitle-less video costs nothing.
      await refundMonthlyQuota(userId, userEmail);
      return NextResponse.json(
        {
          error: 'Transcript unavailable: video has no subtitles or extraction failed. Full synthesis requires a textual source.',
          code: 'ERR_TRANSCRIPT_REQUIRED'
        },
        { status: 400 }
      );
    }

    const persona = (validation.data.persona as PersonaId) || detectPersona(metadata.title, metadata.channelTitle);
    const timezone = validation.data.timezone || 'UTC';

    // Single typed metadata object — the contract source of truth reused by the upsert
    // (persisted into validation_report for cache-hit parity) AND the response/worker
    // payload. Counts are stringified here to satisfy WorkerStreamRequest.
    const jobMetadata: AnalysisJobMetadata = {
      title: metadata.title,
      channelTitle: metadata.channelTitle,
      publishedAt: metadata.publishedAt,
      duration: metadata.duration ?? 0,
      viewCount: String(metadata.viewCount),
      likeCount: String(metadata.likeCount),
      commentCount: String(metadata.commentCount),
    };

    // 5. Processing job row (filled by the worker via /api/analyses/persist).
    const service = getSupabaseServiceClient();
    // UPSERT on (user_id, video_id): the analyses table has a UNIQUE(user_id, video_id)
    // index, so a user has at most one row per video. A plain INSERT 23505'd whenever a
    // video was re-analyzed after an incomplete prior attempt (empty markdown → cache
    // miss above), which silently orphaned the stream (persist then 404'd). Re-analysis
    // now reuses + resets the existing row; the RETURNED id is the canonical analysisId
    // the worker persists back to.
    const { data: prepared, error: insertError } = await service
      .from('analyses')
      .upsert(
        {
          video_id: videoId,
          user_id: userId,
          title: metadata.title,
          analysis_markdown: '',
          model_used: 'edge-stream',
          validation_report: {
            status: 'processing',
            transcript_available: true,
            analysis_type: 'full',
            stale_after: new Date(Date.now() + PROCESSING_STALE_MS).toISOString(),
            // Persisted for cache-hit contract parity (see step 2). The persist route
            // preserves this via `...priorReport`, so it survives stream completion.
            metadata: jobMetadata,
            persona,
            timezone,
          },
          validation_passed: false,
        },
        { onConflict: 'user_id,video_id' }
      )
      .select('id')
      .single();

    if (insertError || !prepared?.id) {
      Sentry.captureException(insertError ?? new Error('upsert returned no row'), { tags: { operation: 'analysis-prepare-upsert' }, extra: { videoId, userId } });
      console.error('[analyses] processing-row upsert failed:', insertError?.message);
      // Quota was already charged (line ~94); refund it so a failed init doesn't leak a credit.
      try { await refundMonthlyQuota(userId, userEmail); } catch (e) { Sentry.captureException(e); }
      return NextResponse.json({ error: 'Failed to initialize analysis', code: 'ERR_ANALYSIS_ROW_INSERT' }, { status: 500 });
    }
    const analysisId = prepared.id as string;

    // 6. Mint the token (bound to videoId+analysisId) and return the stream payload.
    //    The system prompt is NOT included — the worker builds it server-side.
    const { sig, exp } = signStreamToken(videoId, analysisId);
    const responseHeaders = new Headers({ 'X-Active-Persona': persona });
    if (trafficHeaders) Object.entries(trafficHeaders).forEach(([k, v]) => responseHeaders.set(k, v));

    return NextResponse.json(
      {
        id: analysisId,
        analysisId,
        videoId,
        status: 'processing',
        title: metadata.title,
        persona,
        detectedPersona: persona,
        analysisAt: new Date().toISOString(),
        timezone,
        transcript,
        metadata: jobMetadata,
        streaming: {
          started: new Date().toISOString(),
          interrupted: false,
          dimensionsReceived: [],
        },
        stream: {
          url: `${process.env.NEXT_PUBLIC_WORKER_URL || ''}/analyze-llm-stream`,
          sig,
          exp,
        },
      },
      { status: 202, headers: responseHeaders }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, {
      contexts: { api: { videoId: extractVideoId(body?.url || ''), endpoint: '/api/analyses' } },
    });
    console.error('[analyses] Prepare failed:', { message: errorMessage, url: body?.url });
    return NextResponse.json({ error: errorMessage, code: 'ERR_ANALYSIS_PREPARE_FAILED' }, { status: 500 });
  }
}

export async function GET() {
  try {
    // 1. Auth: Get user from session
    const supabase = await getSupabaseClientWithAuth();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Fetch user's analyses from Supabase (most recent first)
    const { data: analyses, error } = await supabase
      .from('analyses')
      .select('id, video_id, title, created_at, validation_passed, validation_report')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[analyses GET] Database query failed:', error);
      return NextResponse.json({ error: 'Failed to fetch analyses', code: 'ERR_DB_QUERY' }, { status: 500 });
    }

    // 3. Transform response to match frontend schema
    const historyItems = (analyses || []).map(analysis => ({
      id: analysis.id,
      videoId: analysis.video_id,
      title: analysis.title || 'Untitled Analysis',
      createdAt: analysis.created_at,
      status: analysis.validation_passed ? 'completed' :
              (analysis.validation_report?.status === 'processing' ? 'processing' : 'incomplete'),
    }));

    return NextResponse.json({ analyses: historyItems }, { status: 200 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[analyses GET] Exception:', { message: errorMessage });
    Sentry.captureException(error, { contexts: { api: { endpoint: '/api/analyses (GET)' } } });
    return NextResponse.json({ error: errorMessage, code: 'ERR_ANALYSIS_FETCH_FAILED' }, { status: 500 });
  }
}
