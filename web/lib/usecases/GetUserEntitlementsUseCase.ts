import * as Sentry from '@sentry/nextjs';

import { getSupabaseServiceClient } from '@/lib/supabase';

import type { PlanTier } from '@/lib/types/billing';

export interface EntitlementState {
  tier: PlanTier;
  is_founder: boolean;
  is_enterprise: boolean;
  is_unlimited: boolean;
  canAnalyzeVideo: boolean;
  canAccessKnowledgeGraph: boolean;
  canUseExtendedChat: boolean;
  canExportKnowledgeGraph: boolean;
}

const TIER_RANK: Record<PlanTier, number> = {
  enterprise: 4,
  founder: 3,
  pro: 2,
  free: 1,
};

export class GetUserEntitlementsUseCase {
  async execute(userId: string): Promise<EntitlementState> {
    const defaultFree: EntitlementState = {
      tier: 'free',
      is_founder: false,
      is_enterprise: false,
      is_unlimited: false,
      canAnalyzeVideo: true,
      canAccessKnowledgeGraph: false,
      canUseExtendedChat: false,
      canExportKnowledgeGraph: false,
    };

    if (!userId) {
      return defaultFree;
    }

    try {
      const supabase = getSupabaseServiceClient();
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
      const valid = rows.filter((row) => {
        if (!row.current_period_end) return true;
        return new Date(row.current_period_end) > now;
      });

      if (valid.length === 0) {
        return defaultFree;
      }

      valid.sort((subA, subB) => (TIER_RANK[subB.plan_tier as PlanTier] ?? 0) - (TIER_RANK[subA.plan_tier as PlanTier] ?? 0));
      const best = valid[0]!;

      const planTier = best.plan_tier as PlanTier;
      const isEnterprise = planTier === 'enterprise';
      const isUnlimited = isEnterprise;
      const isFounder = planTier === 'founder';

      if (isUnlimited || isEnterprise || planTier === 'founder' || planTier === 'pro') {
        const hasPremium = true;
        return {
          tier: planTier,
          is_founder: isFounder,
          is_enterprise: isEnterprise,
          is_unlimited: isUnlimited,
          canAnalyzeVideo: true,
          canAccessKnowledgeGraph: hasPremium,
          canUseExtendedChat: hasPremium,
          canExportKnowledgeGraph: hasPremium,
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
