import * as Sentry from '@sentry/nextjs';

import { getSupabaseServiceClient } from '@/lib/supabase';

import type { PlanTier } from '@/lib/types/billing';

export interface EntitlementState {
  tier: 'free' | 'founder' | 'pro';
  canAnalyzeVideo: boolean;
  canAccessKnowledgeGraph: boolean;
  canUseExtendedChat: boolean;
}

export class GetUserEntitlementsUseCase {
  async execute(userId: string): Promise<EntitlementState> {
    const defaultFree: EntitlementState = {
      tier: 'free',
      canAnalyzeVideo: true,
      canAccessKnowledgeGraph: false,
      canUseExtendedChat: false,
    };

    if (!userId) {
      return defaultFree;
    }

    try {
      const supabase = getSupabaseServiceClient();
      // Select all active/trialing rows, ordered by tier rank then recency, to pick the best one.
      const { data: rows, error } = await supabase
        .from('user_subscriptions')
        .select('plan_tier, status, current_period_end')
        .eq('user_id', userId)
        .in('status', ['active', 'trialing'])
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[GetUserEntitlementsUseCase] Error querying subscription:', error.message);
        Sentry.captureException(new Error(error.message), {
          tags: { usecase: 'GetUserEntitlementsUseCase' },
          extra: { userId },
        });
        throw new Error(`Database error querying subscription: ${error.message}`);
      }

      if (!rows || rows.length === 0) {
        return defaultFree;
      }

      const now = new Date();
      // Filter expired rows — if current_period_end is set and in the past, skip.
      const valid = rows.filter((row) => {
        if (!row.current_period_end) return true; // no expiry set (e.g. lifetime)
        return new Date(row.current_period_end) > now;
      });

      if (valid.length === 0) {
        return defaultFree;
      }

      // Prefer founder > pro > free ordering
      const TIER_RANK: Record<string, number> = { founder: 2, pro: 1, free: 0 };
      valid.sort((subA, subB) => (TIER_RANK[subB.plan_tier] ?? 0) - (TIER_RANK[subA.plan_tier] ?? 0));
      const best = valid[0]!;

      const planTier = best.plan_tier as PlanTier;
      if (planTier === 'founder' || planTier === 'pro') {
        return {
          tier: planTier,
          canAnalyzeVideo: true,
          canAccessKnowledgeGraph: true,
          canUseExtendedChat: true,
        };
      }

      return defaultFree;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      Sentry.captureException(err instanceof Error ? err : new Error(errorMsg), {
        tags: { usecase: 'GetUserEntitlementsUseCase' },
        extra: { userId },
      });
      throw err instanceof Error ? err : new Error(errorMsg);
    }
  }
}
