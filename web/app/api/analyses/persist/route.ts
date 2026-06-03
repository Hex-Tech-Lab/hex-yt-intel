export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyContentSig } from '@/lib/stream-token';
import { setAnalysisCache, generateCacheKey, type CachedAnalysisResult } from '@/lib/services/cache';
import { publishValidationTask } from '@/lib/qstash-client';
import { env } from '@/lib/env';
import * as Sentry from '@sentry/nextjs';

/**
 * Server-to-server persistence endpoint. The Cloudflare Worker calls this (from
 * ctx.waitUntil, after the stream completes or is interrupted) with the generated 
 * markdown and an HMAC content signature. 
 * 
 * FIX: We use the raw @supabase/supabase-js client here because the SSR wrapper
 * (@supabase/ssr) expects cookies to establish a session, which causes 401 errors
 * in Server-to-Server calls.
 */
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
    const { analysisId, videoId, markdown, model, valid, contentSig, status = 'completed' } = body || {};

    if (!analysisId || !videoId || typeof markdown !== 'string' || !contentSig) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Tamper check: proves this markdown came from the worker, not a forged caller.
    if (!verifyContentSig(markdown, contentSig)) {
      console.warn('[analyses/persist] Invalid content signature', { analysisId, videoId });
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Instantiate RAW client with service role to bypass RLS and avoid cookie dependencies.
    const service = createClient(
      env.supabaseUrl,
      env.supabaseServiceRoleKey!
    );

    // Fetch the processing row to recover its context (user, transcript availability).
    const { data: row, error: fetchError } = await service
      .from('analyses')
      .select('id, user_id, title, validation_report, created_at')
      .eq('id', analysisId)
      .eq('video_id', videoId)
      .maybeSingle();

    if (fetchError || !row) {
      return NextResponse.json({ error: 'Analysis row not found' }, { status: 404 });
    }

    const priorReport = (row.validation_report as any) || {};
    const isInterrupted = status === 'interrupted';

    const { error: updateError } = await service
      .from('analyses')
      .update({
        analysis_markdown: markdown,
        model_used: model || 'edge-stream',
        validation_passed: isInterrupted ? false : !!valid,
        validation_report: { 
          ...priorReport, 
          status: isInterrupted ? 'interrupted' : 'done', 
          model_used: model, 
          valid: isInterrupted ? false : !!valid 
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', analysisId);

    if (updateError) {
      Sentry.captureException(updateError, { tags: { operation: 'analysis-persist' } });
      return NextResponse.json({ error: 'Failed to persist analysis' }, { status: 500 });
    }

    // Skip cache and validation for interrupted/partial streams.
    if (isInterrupted) {
      return NextResponse.json({ ok: true, analysisId, status: 'interrupted' });
    }

    // Best-effort cache + validation task (never block the persist response on these).
    const transcriptAvailable = !!priorReport.transcript_available;
    const cachedPayload: CachedAnalysisResult = {
      id: analysisId,
      video_id: videoId,
      title: row.title,
      analysis_markdown: markdown,
      validation_report: priorReport,
      model_used: model || 'edge-stream',
      created_at: row.created_at,
      cached_at: new Date().toISOString(),
    };
    const cacheKey = generateCacheKey('edge-stream', markdown, '5.1');
    await setAnalysisCache(cacheKey, cachedPayload).catch(() => {});

    if (transcriptAvailable) {
      await publishValidationTask({
        videoId,
        markdown,
        filename: `${videoId}.md`,
        userId: row.user_id,
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
