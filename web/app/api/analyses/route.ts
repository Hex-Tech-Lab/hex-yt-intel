export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Bouncer only: auth + quota + ingestion + mint a streaming token, then return fast.
// The slow LLM generation streams directly browser<->Cloudflare Worker (no Vercel
// function in the LLM path), so the 60s Hobby ceiling never applies. ~8s typical.
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { AnalysisCreateSchema } from '@/lib/types/contracts';
import { extractVideoId } from '@/lib/youtube';
import * as Sentry from '@sentry/nextjs';
import {
  SupabaseAuthAdapter,
  RedisTrafficAdapter,
  PostgresBillingAdapter,
  WorkerIngestionAdapter,
  SettingsModelAdapter,
  StreamTokenAdapter,
  SupabasePersistenceAdapter,
} from '@/lib/adapters';
import type { PersonaId } from '@/lib/prompts';

// Module-level singleton adapters — created once per cold-start, reused across requests.
const authAdapter = new SupabaseAuthAdapter();
const trafficAdapter = new RedisTrafficAdapter();
const billingAdapter = new PostgresBillingAdapter();
const ingestionAdapter = new WorkerIngestionAdapter();
const modelAdapter = new SettingsModelAdapter();
const tokenAdapter = new StreamTokenAdapter();
const persistenceAdapter = new SupabasePersistenceAdapter();

export async function POST(request: NextRequest) {
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

    // 1. Auth — STRICT tenant isolation. Identity is derived ONLY from the verified
    // Supabase session; there is no static/bearer test bypass on this route.
    const identity = await authAdapter.authenticate();
    if (!identity) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { userId, email: userEmail, tier } = identity;

    // 2. Cache hit — must return the SAME contract shape as the fresh-job path so
    // the client treats both interchangeably. Persisted validation_report restores
    // metadata/persona/timezone so the UI never renders blank.
    if (!validation.data.forceRefresh) {
      const cached = await persistenceAdapter.findCachedAnalysis({ userId, videoId });
      if (cached) {
        const cachedPersona = cached.cachedReport.persona || 'analyst';
        return NextResponse.json({
          id: cached.id,
          analysisId: cached.id,
          videoId,
          status: 'done',
          title: cached.title,
          markdown: cached.analysisMarkdown,
          analysis_markdown: cached.analysisMarkdown,
          createdAt: cached.createdAt,
          analysisAt: cached.createdAt,
          persona: cachedPersona,
          detectedPersona: cachedPersona,
          timezone: cached.cachedReport.timezone || validation.data.timezone || 'UTC',
          metadata: cached.cachedReport.metadata,
          dimensions: cached.dimensions,
          streaming: {
            started: cached.createdAt,
            interrupted: false,
            dimensionsReceived: Object.keys(cached.dimensions).map(Number),
          },
          cacheHit: true,
          message: 'Retrieved from persistent cache.',
        });
      }
    }

    // 3a. Traffic guard: per-minute rate limit (DDoS protection)
    const trafficResult = await trafficAdapter.checkGate({
      userId,
      tier,
      email: userEmail,
      endpoint: 'analyses',
      clientIp: request.headers.get('x-forwarded-for') ?? undefined,
      userAgent: request.headers.get('user-agent') ?? undefined,
    });
    if (!trafficResult.allowed && trafficResult.denialResponse) {
      return trafficResult.denialResponse;
    }

    // 3b. Billing charge: monthly quota enforcement
    const billingResult = await billingAdapter.checkGate({
      userId,
      tier,
      email: userEmail,
      endpoint: 'analyses',
    });
    if (!billingResult.allowed && billingResult.denialResponse) {
      return billingResult.denialResponse;
    }

    // 4. Ingestion: parallel metadata + transcript fetch
    let ingestionResult;
    try {
      ingestionResult = await ingestionAdapter.fetch(videoId);
    } catch {
      // Quota was charged at step 3; ingestion failed before any generation ran — refund.
      await billingAdapter.refund({ userId, email: userEmail });
      return NextResponse.json({ error: 'Failed to fetch video metadata', code: 'ERR_METADATA_FETCH' }, { status: 502 });
    }

    // Transcript Absolutism: no usable source means no analysis can run. Refund the
    // quota unit so a subtitle-less video costs nothing.
    if (!ingestionResult.transcriptAvailable || !ingestionResult.transcript.trim()) {
      console.warn('[analyses] Empty transcript, halting analysis', { videoId });
      await billingAdapter.refund({ userId, email: userEmail });
      return NextResponse.json(
        {
          error: 'Transcript unavailable: video has no subtitles or extraction failed. Full synthesis requires a textual source.',
          code: 'ERR_TRANSCRIPT_REQUIRED',
        },
        { status: 400 }
      );
    }

    const persona = (validation.data.persona as PersonaId) || ingestionAdapter.detectPersona({
      title: ingestionResult.metadata.title,
      channelTitle: ingestionResult.metadata.channelTitle,
    });
    const timezone = validation.data.timezone || 'UTC';
    const jobMetadata = ingestionAdapter.buildJobMetadata(ingestionResult.metadata);

    // 5. Processing job row — UPSERT on (user_id, video_id) so re-analysis reuses
    // the existing row instead of 23505-ing. The returned id is the canonical
    // analysisId the worker persists back to via /api/analyses/persist.
    let analysisId: string;
    try {
      const stub = await persistenceAdapter.upsertProcessingStub({
        videoId,
        userId,
        title: ingestionResult.metadata.title,
        validationReport: {
          status: 'processing',
          transcriptAvailable: ingestionResult.transcriptAvailable,
          analysisType: 'full',
          staleAfter: new Date(Date.now() + 180_000).toISOString(),
          metadata: jobMetadata,
          persona,
          timezone,
        },
      });
      analysisId = stub.id;
    } catch (insertError) {
      // Quota was already charged; refund so a failed init doesn't leak a credit.
      try { await billingAdapter.refund({ userId, email: userEmail }); } catch (e) { Sentry.captureException(e); }
      Sentry.captureException(insertError as any, { tags: { operation: 'analysis-prepare-upsert' }, extra: { videoId, userId } });
      console.error('[analyses] processing-row upsert failed:', (insertError as any)?.message);
      return NextResponse.json({ error: 'Failed to initialize analysis', code: 'ERR_ANALYSIS_ROW_INSERT' }, { status: 500 });
    }

    // 6. Resolve per-tier model cascade (app_settings DB-backed; falls back to hardcoded)
    // and mint the HMAC token bound to videoId+analysisId+models. The worker runs
    // exactly this cascade and the browser cannot escalate to expensive models.
    const analysisModels = await modelAdapter.resolveModels(tier, 'analysis');
    const { sig, exp } = tokenAdapter.signAnalysisToken({ videoId, analysisId, models: analysisModels });
    const responseHeaders = new Headers({ 'X-Active-Persona': persona });
    if (trafficResult.headers) {
      Object.entries(trafficResult.headers).forEach(([k, v]) => responseHeaders.set(k, v));
    }

    return NextResponse.json(
      {
        id: analysisId,
        analysisId,
        videoId,
        status: 'processing',
        title: ingestionResult.metadata.title,
        persona,
        detectedPersona: persona,
        analysisAt: new Date().toISOString(),
        timezone,
        transcript: ingestionResult.transcript,
        metadata: jobMetadata,
        models: analysisModels,
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
    const identity = await authAdapter.authenticate();
    if (!identity) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { userId } = identity;

    const { getSupabaseClientWithAuth } = await import('@/lib/supabase');
    const client = await getSupabaseClientWithAuth();
    const { data: analyses, error } = await client
      .from('analyses')
      .select('id, video_id, title, created_at, validation_passed, validation_report')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[analyses GET] Database query failed:', error);
      return NextResponse.json({ error: 'Failed to fetch analyses', code: 'ERR_DB_QUERY' }, { status: 500 });
    }

    const historyItems = (analyses || []).map((analysis: any) => ({
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