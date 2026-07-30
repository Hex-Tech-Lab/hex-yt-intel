export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Sibling webhooks (reaper, upstash-snapshot-poll) omit maxDuration because
// their work is DB-only and always finishes in well under Vercel's default
// (10s Hobby / 15s Pro). This route is structurally different: each
// candidate can spend up to WORKER_CALL_TIMEOUT_MS (90s,
// dimension-remediation.ts) on a real external LLM call before its own
// timeout fires. Without an explicit budget this route would inherit that
// tiny default and get killed by the platform almost immediately -- a real
// gap caught by review, not previously verified. 300s matches this
// codebase's only other multi-item-processing webhook (wiki-builder). The
// route's own candidate limit (below) is sized so the worst case (every
// candidate timing out at 90s) still fits inside this budget with margin.
export const maxDuration = 300;

/**
 * QStash Webhook: Missing-Dimension Remediation
 * Invoked on a schedule by Upstash QStash. Finds analyses stuck partial
 * (billing_status='failed', validation_report.status='partial', real
 * content) and regenerates just the missing dimensions via the worker's
 * existing per-dimension-subset capability. See
 * docs/specs/remediate-missing-dimensions-design.md. Signature-verified
 * before doing any work.
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
      console.warn('[remediate-dimensions-webhook] QStash signature verification failed');
      Sentry.captureMessage('remediate-dimensions-webhook: QStash signature verification failed', {
        level: 'warning',
        tags: { endpoint: '/api/webhooks/remediate-dimensions' },
      });
      return NextResponse.json({ error: 'Unauthorized: Invalid QStash signature' }, { status: 401 });
    }

    // limit=3: worst case (every candidate hits the full 90s worker timeout)
    // is 3 * (90s + 4s stagger) = 282s, safely inside maxDuration=300s above.
    // limit=10 (the harness's own default) would be 940s worst case --
    // guaranteed to get killed mid-run by the platform, stranding the Redis
    // lock until its own TTL expiry and losing whatever candidate was
    // in-flight. Real-world calls are usually far faster than the 90s
    // ceiling, so 3/tick still clears the current ~45-row backlog within a
    // few hours at this cron's 30-min cadence -- not a meaningful capacity
    // loss for the actual (low) request volume this feature targets.
    const result = await runRemediationHarness({ limit: 3 });
    console.log('[remediate-dimensions-webhook] sweep complete', result);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { contexts: { api: { endpoint: '/api/webhooks/remediate-dimensions' } } });
    console.error('[remediate-dimensions-webhook] sweep failed:', { message });
    return NextResponse.json({ error: message, code: 'ERR_REMEDIATION_SWEEP_FAILED' }, { status: 500 });
  }
}
