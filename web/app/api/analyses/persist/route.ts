export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { verifyContentSig } from '@/lib/stream-token';
import { UCISPayloadV2Schema } from '@/lib/validators/synthesis';
import { setAnalysisCache, generateCacheKey, type CachedAnalysisResult } from '@/lib/services/cache';
import { publishValidationTask } from '@/lib/qstash-client';
import { SupabasePersistenceAdapter } from '@/lib/adapters';
import * as Sentry from '@sentry/nextjs';

/**
 * Server-to-server persistence endpoint. The Cloudflare Worker calls this (from
 * ctx.waitUntil, after the stream completes or is interrupted) with the generated
 * markdown and an HMAC content signature.
 *
 * ADR 006: Dual-write persistence
 * - analysis_markdown: Reconstructed markdown for backward compat + PDF export
 * - analysis_payload: Structured JSON (v2.0 schema) for KG visualization + cache hits
 */
export async function POST(request: NextRequest) {
  let body: { analysisId?: string; videoId?: string; markdown?: string; payload?: unknown; model?: string; valid?: boolean; contentSig?: string; status?: string } | undefined;
  try {
    body = await request.json();
    const { analysisId, videoId, markdown, payload, model, valid, contentSig, status = 'completed' } = body || {};

    if (!analysisId || !videoId || typeof markdown !== 'string' || !contentSig) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Tamper check: proves this markdown+payload came from the worker, not a forged caller.
    // Canonical signable matches the worker's canonical = JSON.stringify({ markdown, payload }).
    const canonical = JSON.stringify({ markdown, payload: payload ?? null });
    if (!verifyContentSig(canonical, contentSig)) {
      console.warn('[analyses/persist] Invalid content signature', { analysisId, videoId });
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // ADR 006: Validate payload schema before persisting to JSONB column.
    if (payload !== undefined && payload !== null) {
      const parseResult = UCISPayloadV2Schema.safeParse(payload);
      if (!parseResult.success) {
        console.warn('[analyses/persist] Invalid payload schema', { analysisId, videoId, errors: parseResult.error.flatten() });
        return NextResponse.json({ error: 'Invalid payload schema' }, { status: 400 });
      }
    }

    const persistenceAdapter = new SupabasePersistenceAdapter();

    // Fetch the processing row to recover its context (user, transcript availability).
    const row = await persistenceAdapter.findAnalysisForPersist({ analysisId, videoId });

    if (!row) {
      // Authenticated (valid content sig) but no matching row. Usual cause: the bouncer
      // wrote the processing row to a DIFFERENT environment's DB (e.g. a preview branch)
      // while the worker's APP_URL points at prod. Capture so the orphan is visible.
      Sentry.captureMessage('analysis-persist: row not found', {
        level: 'warning',
        tags: { operation: 'analysis-persist', reason: 'row-not-found' },
        extra: { analysisId, videoId, status },
      });
      console.warn('[analyses/persist] Row not found (env mismatch?)', { analysisId, videoId });
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    const priorReport = (row.validationReport as any) || {};
    const isInterrupted = status === 'interrupted';

    const newReport = {
      ...priorReport,
      status: isInterrupted ? 'interrupted' : 'done',
      model_used: model,
      valid: isInterrupted ? false : !!valid,
    };

    // ADR 006: Dual-write - update both markdown and JSON payload columns via adapter
    await persistenceAdapter.updateAnalysisResult({
      analysisId,
      markdown,
      payload,
      model: model || null,
      validationPassed: isInterrupted ? false : !!valid,
      status: isInterrupted ? 'interrupted' : 'done',
      validationReport: newReport,
    });

    // Skip cache and validation for interrupted/partial streams.
    if (isInterrupted) {
      return NextResponse.json({ ok: true, analysisId, status: 'interrupted' });
    }

    // ADR 006: Best-effort cache + validation task (never block the persist response).
    // Cache includes both markdown and structured JSON payload for v2.0 cache hits.
    const transcriptAvailable = !!priorReport.transcript_available;
    const cachedPayload: CachedAnalysisResult = {
      id: analysisId,
      video_id: videoId,
      title: row.title,
      analysis_markdown: markdown,
      analysis_payload: (payload ?? null) as Record<string, unknown> | null,
      validation_report: priorReport,
      model_used: model || 'edge-stream',
      created_at: row.createdAt,
      cached_at: new Date().toISOString(),
    };
    const cacheKey = generateCacheKey('edge-stream', markdown, '5.1');
    await setAnalysisCache(cacheKey, cachedPayload).catch(() => {});

    if (transcriptAvailable) {
      await publishValidationTask({
        videoId,
        markdown,
        filename: `${videoId}.md`,
        userId: row.userId,
        analysisId,
        metadata: { title: row.title, channelTitle: '' },
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true, analysisId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { tags: { operation: 'analysis-persist' }, contexts: { api: { endpoint: '/api/analyses/persist' } } });
    console.error('[analyses/persist] Failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}