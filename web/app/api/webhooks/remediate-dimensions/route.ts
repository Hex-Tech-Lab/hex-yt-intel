export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * QStash Webhook: Missing-Dimension Remediation
 * Invoked on a schedule by Upstash QStash. Finds analyses stuck partial
 * (billing_status='failed', validation_report.status='partial', real
 * content) and regenerates just the missing dimensions via the worker's
 * existing per-dimension-subset capability. See
 * docs/specs/remediate-missing-dimensions-design.md. Signature-verified
 * before doing any work.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyQStashSignature } from '@/lib/qstash-client';
import { runRemediationHarness } from '@/lib/services/dimension-remediation';
import * as Sentry from '@sentry/nextjs';

export async function POST(request: NextRequest) {
  try {
    const bodyText = await request.clone().text();

    const signature = request.headers.get('upstash-signature') || '';
    const verified = await verifyQStashSignature(signature, bodyText);
    if (!verified) {
      console.warn('[remediate-dimensions-webhook] QStash signature verification failed');
      return NextResponse.json({ error: 'Unauthorized: Invalid QStash signature' }, { status: 401 });
    }

    const result = await runRemediationHarness({ limit: 10 });
    console.log('[remediate-dimensions-webhook] sweep complete', result);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { contexts: { api: { endpoint: '/api/webhooks/remediate-dimensions' } } });
    console.error('[remediate-dimensions-webhook] sweep failed:', { message });
    return NextResponse.json({ error: message, code: 'ERR_REMEDIATION_SWEEP_FAILED' }, { status: 500 });
  }
}
