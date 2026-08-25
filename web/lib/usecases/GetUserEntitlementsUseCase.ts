import { getSupabaseServiceClient } from '@/lib/supabase';
import * as Sentry from '@sentry/nextjs';
import type { PlanTier, SubscriptionStatus } from '@/lib/types/billing';

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
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select('plan_tier, status, current_period_end')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[GetUserEntitlementsUseCase] Error querying subscription:', error.message);
        Sentry.captureException(new Error(error.message), {
          tags: { usecase: 'GetUserEntitlementsUseCase' },
          extra: { userId },
        });
        return defaultFree;
      }

      if (!data) {
        return defaultFree;
      }

      const status = data.status as SubscriptionStatus;
      const planTier = data.plan_tier as PlanTier;

      // Active or trialing subscriptions unlock features based on their plan tier
      const isActive = status === 'active' || status === 'trialing';

      if (!isActive) {
        return defaultFree;
      }

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
      return defaultFree;
    }
  }
}
