export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Sibling webhooks (reaper, upstash-snapshot-poll) omit maxDuration because
// their work is DB-only and always finishes in well under Vercel's default
// (10s Hobby / 15s Pro). This route is structurally different: each
// candidate can spend up to 90s (dimension-remediation.ts's streaming
// timeout) on a real external LLM call. Since ADR 019, the token-bucket
// budget is the PRIMARY pacing mechanism (a cycle stops itself once the
// bucket is empty, before duration is ever a concern) -- maxDuration here
// is a safety ceiling for the platform, not the thing bounding cost or
// candidate count. 300s matches this codebase's only other multi-item-
// processing webhook (wiki-builder).
export const maxDuration = 300;

/**
 * QStash Webhook: Missing-Dimension Remediation
 * Invoked on a schedule by Upstash QStash. Finds analyses stuck partial
 * (billing_status='failed', validation_report.status='partial', real
 * content) and regenerates just the missing dimensions via the worker's
 * existing per-dimension-subset capability, budget-gated per ADR 019. See
 * docs/specs/ADR_019_REMEDIATION_BUDGET_TOKEN_BUCKET_2026-07-31.md.
 * Signature-verified before doing any work.
 */
import * as Sentry from '@sentry/nextjs';
import { NextRequest, NextResponse } from 'next/server';

import { verifyQStashSignature } from '@/lib/qstash-client';
import { runRemediationHarness } from '@/lib/services/dimension-remediation';

export async function POST(request: NextRequest) {
  try {
    // No .clone() needed -- unlike some sibling webhook routes, nothing else
    // in this handler reads `request` after this line, so consuming the
    // body once directly is sufficient.
    const bodyText = await request.text();

    const signature = request.headers.get('upstash-signature') || '';
    const verified = await verifyQStashSignature(signature, bodyText);
    if (!verified) {
      console.warn('[remediate-dimensions-webhook] QStash signature verification failed', { hasSignatureHeader: Boolean(signature) });
      Sentry.captureMessage('remediate-dimensions-webhook: QStash signature verification failed', {
        level: 'warning',
        tags: { endpoint: '/api/webhooks/remediate-dimensions' },
      });
      return NextResponse.json({ error: 'Unauthorized: Invalid QStash signature' }, { status: 401 });
    }

    const result = await runRemediationHarness();
    console.log('[remediate-dimensions-webhook] sweep complete', result);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { contexts: { api: { endpoint: '/api/webhooks/remediate-dimensions' } } });
    console.error('[remediate-dimensions-webhook] sweep failed:', { message });
    return NextResponse.json({ error: message, code: 'ERR_REMEDIATION_SWEEP_FAILED' }, { status: 500 });
  }
}
