export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { SupabaseAuthAdapter, SupabasePersistenceAdapter } from '@/lib/adapters';

// Module-level singletons — created once per cold-start, reused across requests.
const authAdapter = new SupabaseAuthAdapter();
const persistenceAdapter = new SupabasePersistenceAdapter();

/**
 * GET /api/analyses/overview — video-centric history for the signed-in user.
 * One aggregated row per underlying video (archived re-runs collapsed), with
 * times analyzed, views, best/missing dimensions, and an honest rollup status.
 * Identity is derived strictly from the verified Supabase session (tenant
 * isolation is enforced inside the aggregation query by user id).
 */
export async function GET() {
  try {
    const identity = await authAdapter.authenticate();
    if (!identity) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const items = await persistenceAdapter.getUserHistoryOverview({ userId: identity.userId });
    return NextResponse.json({ items }, { status: 200 });
  } catch (error) {
    // Log the real error server-side; never echo raw DB/RPC text to the client
    // (it can leak function/column/schema identifiers). Return a generic message.
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[analyses/overview GET] Exception:', { message: errorMessage });
    Sentry.captureException(error, { contexts: { api: { endpoint: '/api/analyses/overview (GET)' } } });
    return NextResponse.json(
      { error: 'Failed to load history overview', code: 'ERR_HISTORY_OVERVIEW_FAILED' },
      { status: 500 }
    );
  }
}
