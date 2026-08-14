import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { verifyResourceOwnership } from '@/lib/services/ownership';
import { getSupabaseServiceClient } from '@/lib/supabase';

const analysisIdSchema = z.string().uuid();
const bodySchema = z.object({ reason: z.string().max(500).optional() });

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/analyses/[id]/fail — client-observed terminal stream failure
 * write-back. Before this route existed, useSSEStream.ts's settleAnalysis
 * ('error', ...) only set local Zustand state: the `analyses.billing_status`
 * row stayed 'processing' forever (until the ADR 007 reaper's delayed sweep),
 * so a page refresh either found nothing to restore or, worse, told the user
 * "Re-attached to active background analysis" for a stream that had already
 * died (live-reported "amnesia" bug, 2026-08-15).
 *
 * Guarded update (hand-written, not routed through updateAnalysisResult —
 * that RPC unconditionally requires markdown/payload params this failure
 * report never has): `.eq('id', ...).eq('billing_status', 'processing')`
 * is the same single-winner compare-and-swap semantics as analysis-reaper.ts's
 * buildSettlePatch, so this can never race a legitimate worker-side /persist
 * completion into a false failure.
 *
 * Uses the service-role client (bypasses RLS) for a different reason than
 * the reaper does: the reaper bypasses because it runs with no user session
 * at all; this route bypasses because the write must succeed independent of
 * `analyses_update_own`'s `auth.uid() = user_id` RLS check on a
 * service-triggered failure report — ownership is verified separately,
 * above, before this query ever runs.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: analysisId } = await params;

  if (!analysisIdSchema.safeParse(analysisId).success) {
    return NextResponse.json({ error: 'Invalid analysis id' }, { status: 400 });
  }

  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  const reason = body.success ? body.data.reason : undefined;

  try {
    const { error } = await verifyResourceOwnership<any>(analysisId, 'analyses', 'id, user_id');

    if (error === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error === 'InternalError') {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    if (error === 'NotFound') {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    const service = getSupabaseServiceClient();
    const nowIso = new Date().toISOString();
    const { data, error: updateError } = await service
      .from('analyses')
      .update({
        billing_status: 'failed',
        validation_report: { status: 'failed', client_reported: true, reason: reason || 'Client-observed stream failure', failed_at: nowIso },
        updated_at: nowIso,
      })
      .eq('id', analysisId)
      .eq('billing_status', 'processing')
      .select('id')
      .maybeSingle();

    if (updateError) throw updateError;

    // No row matched the guard: either already settled (complete/failed by
    // the worker or reaper) or raced — both are fine, not an error. This
    // endpoint's job is only to make sure a lingering 'processing' row
    // doesn't outlive a stream the client already knows is dead.
    return NextResponse.json({ marked: Boolean(data) });
  } catch (err: unknown) {
    Sentry.captureException(err, { tags: { operation: 'fail-analysis' }, extra: { analysisId } });
    console.error('[failAnalysis]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
