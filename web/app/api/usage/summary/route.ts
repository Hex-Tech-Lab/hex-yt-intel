export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextResponse } from 'next/server';
import { SupabaseAuthAdapter, SupabasePersistenceAdapter } from '@/lib/adapters';
import type { UserTier } from '@/lib/types/billing';

// Must match PostgresBillingAdapter's MONTHLY_QUOTAS -- duplicated here rather
// than imported because that constant is module-private; if it ever moves to
// the settings registry (it should, per the standing no-hardcoded-tunables
// rule), this should read the same registry key instead of restating it.
const ANALYSIS_MONTHLY_QUOTA: Record<UserTier, number | null> = {
  free: 3,
  pro: null,
  enterprise: null,
};

/**
 * GET /api/usage/summary — Usage tab data: this calendar month's analyses
 * (reusing the same live-count query the billing quota gate already trusts)
 * plus chat turns broken down by surface (synthesis console vs Atlas) and
 * any attributed cost, from usage_logs. Read-only, own-user-only.
 *
 * Chat-turn/cost figures depend on the `chat_turn`/`analysis_completed`
 * usage_logs writers landing (a parallel workstream) -- if those haven't
 * run yet for a user, the corresponding counts are simply 0, not an error;
 * this route never assumes a specific writer has fired.
 */
export async function GET() {
  const authAdapter = new SupabaseAuthAdapter();
  const identity = await authAdapter.authenticate();
  if (!identity) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const persistence = new SupabasePersistenceAdapter();
    const now = new Date();
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

    const [monthlyAnalyses, eventCounts, profile] = await Promise.all([
      persistence.getMonthlyAnalyses({ userId: identity.userId, since }),
      persistence.getUsageEventCounts({ userId: identity.userId, since }),
      persistence.getUserProfile(identity.userId),
    ]);

    const tier = (profile?.tier as UserTier) || 'free';
    const analysesThisMonth = monthlyAnalyses.filter((a) => a.billingStatus === 'completed').length;
    const analysisQuota = ANALYSIS_MONTHLY_QUOTA[tier];

    const chatTurns = eventCounts.filter((e) => e.action === 'chat_turn');
    const synthesisConsoleTurns = chatTurns.find((e) => e.surface === 'synthesis_console')?.count ?? 0;
    const atlasTurns = chatTurns.find((e) => e.surface === 'atlas')?.count ?? 0;
    const totalCostUsd = eventCounts.reduce((sum, e) => sum + e.costUsd, 0);

    return NextResponse.json({
      periodStart: since,
      tier,
      analyses: {
        used: analysesThisMonth,
        quota: analysisQuota, // null = unlimited
      },
      chatTurns: {
        synthesisConsole: synthesisConsoleTurns,
        atlas: atlasTurns,
        total: synthesisConsoleTurns + atlasTurns,
      },
      estimatedCostUsd: totalCostUsd,
    });
  } catch (error) {
    console.error('[usage/summary] Exception:', error);
    return NextResponse.json({ error: 'Failed to load usage summary' }, { status: 500 });
  }
}
