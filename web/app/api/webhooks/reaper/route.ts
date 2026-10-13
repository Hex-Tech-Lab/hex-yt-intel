export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * QStash Webhook: Stuck-Analysis Reaper (ADR 007)
 * Invoked on a schedule by Upstash QStash. Settles analyses orphaned in
 * `billing_status = 'processing'` past the grace window to a terminal state.
 * Signature-verified before doing any work.
 */
import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { verifyQStashSignature } from '@/lib/qstash-client';
import { sweepStuckAnalyses } from '@/lib/services/analysis-reaper';
import { sweepStaleSampleRuns } from '@/lib/services/sample-run-sweep';

/**
 * QStash-scheduled POST handler: verify the Upstash signature, then run one
 * stuck-analysis sweep. Returns the sweep stats as JSON; 401 on a bad signature.
 */
export async function POST(request: NextRequest) {
  try {
    // Read cloned body first: needed for signature verification without consuming the stream.
    const bodyText = await request.clone().text();

    // Early-return security: verify the QStash signature before any DB work.
    const signature = request.headers.get('upstash-signature') || '';
    const verified = await verifyQStashSignature(signature, bodyText);
    if (!verified) {
      console.warn('[reaper-webhook] QStash signature verification failed');
      return NextResponse.json({ error: 'Unauthorized: Invalid QStash signature' }, { status: 401 });
    }

    const result = await sweepStuckAnalyses();
    // T12c: same QStash tick also releases stuck comment_sample_runs (pending/sampling).
    // A failure here is captured but must not discard the analysis sweep that already ran.
    let sampleRuns: Awaited<ReturnType<typeof sweepStaleSampleRuns>> | null = null;
    try {
      sampleRuns = await sweepStaleSampleRuns();
    } catch (sweepError) {
      Sentry.captureException(sweepError, { tags: { service: 'sample-run-sweep', phase: 'sweep' } });
      console.error('[reaper-webhook] sample-run sweep failed:', sweepError instanceof Error ? sweepError.message : String(sweepError));
    }
    console.log('[reaper-webhook] sweep complete', { ...result, sampleRuns });
    return NextResponse.json({ ok: true, ...result, sampleRuns });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { contexts: { api: { endpoint: '/api/webhooks/reaper' } } });
    console.error('[reaper-webhook] sweep failed:', { message });
    return NextResponse.json({ error: message, code: 'ERR_REAPER_SWEEP_FAILED' }, { status: 500 });
  }
}
