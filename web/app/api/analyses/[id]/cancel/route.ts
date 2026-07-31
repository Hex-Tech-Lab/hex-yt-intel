import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { verifyResourceOwnership } from '@/lib/services/ownership';
import { setRedisValue } from '@/lib/redis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Matches LLMCascade's own per-call timeout ceiling (worker/src/services/
// LLMCascade.ts, 120s) plus buffer for the worker's 3s cancel-poll interval
// (worker/src/routes/analysis.ts) -- the flag only needs to outlive one
// in-flight generation, not linger indefinitely.
const CANCEL_FLAG_TTL_SECONDS = 150;

/**
 * POST /api/analyses/[id]/cancel — ADR 020 Phase 1. Sets a Redis flag the
 * Cloudflare Worker polls (UpstashCacheAdapter.isCancelled) to actually abort
 * its in-flight OpenRouter call, distinct from the client just closing its
 * own SSE connection (which the worker deliberately ignores, see the
 * 2026-07-29 httpConnSignal decoupling -- that must keep working for
 * navigate-away-and-reattach).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: analysisId } = await params;

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

    await setRedisValue(`cancel:${analysisId}`, true, CANCEL_FLAG_TTL_SECONDS);

    return NextResponse.json({ cancelled: true });
  } catch (err: unknown) {
    Sentry.captureException(err, { tags: { operation: 'cancel-analysis' }, extra: { analysisId } });
    console.error('[cancelAnalysis]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
