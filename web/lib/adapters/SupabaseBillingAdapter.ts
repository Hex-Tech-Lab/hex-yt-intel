import { getSupabaseServiceClient } from '@/lib/supabase';
import * as Sentry from '@sentry/nextjs';

/**
 * Manage user subscriptions and analysis billing status in Supabase.
 * Uses service-role client for authorized updates.
 */
export class SupabaseBillingAdapter {
  /**
   * Update a user's subscription tier (pro/free).
   * @param params User ID and new tier
   * @throws Error if user not found or update fails
   */
  static async updateUserTier(params: {
    userId: string;
    tier: 'pro' | 'free';
  }): Promise<void> {
    try {
      const service = getSupabaseServiceClient();
      const { error, count } = await service
        .from('users')
        .update({ tier: params.tier, updated_at: new Date().toISOString() }, { count: 'exact' })
        .eq('id', params.userId);

      if (error) {
        console.error('[SupabaseBillingAdapter] updateUserTier failed:', error.message);
        throw error;
      }

      if (count === 0 || count === null) {
        throw new Error(`No user row matched for userId: ${params.userId} when updating to tier: ${params.tier}`);
      }
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { method: 'updateUserTier' },
        extra: { userId: params.userId, tier: params.tier },
      });
      throw error;
    }
  }

  /**
   * Update an analysis billing status (processing/completed/failed).
   * @param params Analysis ID and new billing status
   * @throws Error if update fails
   */
  static async updateBillingStatus(params: {
    analysisId: string;
    status: 'processing' | 'completed' | 'failed';
  }): Promise<void> {
    try {
      const service = getSupabaseServiceClient();
      const { error } = await service
        .from('analyses')
        .update({
          billing_status: params.status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', params.analysisId);

      if (error) {
        console.error('[SupabaseBillingAdapter] updateBillingStatus failed:', error.message);
        throw error;
      }
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { method: 'updateBillingStatus' },
        extra: { analysisId: params.analysisId, status: params.status },
      });
      throw error;
    }
  }

  /**
   * Fetch user profile including tier, email, and quota usage.
   * @param userId User ID to fetch
   * @returns User profile with tier, email, quota, or null if not found
   */
  static async getUserProfile(userId: string): Promise<{
    email: string | null;
    name: string | null;
    tier: string;
    role: string | null;
    analysesUsed: number;
  } | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('users')
        .select('email, name, tier, role, analyses_used')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('[SupabaseBillingAdapter] getUserProfile failed:', error.message);
        throw error;
      }
      if (!data) return null;

      return {
        email: data.email ?? null,
        name: data.name ?? null,
        tier: data.tier || 'free',
        role: data.role ?? null,
        analysesUsed: data.analyses_used ?? 0,
      };
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { method: 'getUserProfile' },
        extra: { userId },
      });
      throw error;
    }
  }

  static async getUserBillingConfig(userId: string): Promise<{
    stripeCustomerId: string | null;
    tier: string;
    analysesUsed: number;
  } | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('users')
        .select('stripe_customer_id, tier, analyses_used')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('[SupabaseBillingAdapter] getUserBillingConfig failed:', error.message);
        throw error;
      }
      if (!data) return null;

      return {
        stripeCustomerId: data.stripe_customer_id ?? null,
        tier: data.tier || 'free',
        analysesUsed: data.analyses_used ?? 0,
      };
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { method: 'getUserBillingConfig' },
        extra: { userId },
      });
      throw error;
    }
  }

   static async getUsageLogsCountSince(params: {
     userId: string;
     since: string;
   }): Promise<number> {
     try {
       const service = getSupabaseServiceClient();
       const { error, count } = await service
         .from('usage_logs')
         .select('*', { count: 'exact', head: true })
         .eq('user_id', params.userId)
         .gte('created_at', params.since);

       if (error) {
         console.error('[SupabaseBillingAdapter] getUsageLogsCountSince failed:', error.message);
         throw error;
       }
       return count ?? 0;
     } catch (error: unknown) {
       Sentry.captureException(error, {
         tags: { method: 'getUsageLogsCountSince' },
         extra: { userId: params.userId, since: params.since },
       });
       throw error;
     }
   }

  static async getMonthlyAnalyses(params: {
    userId: string;
    since: string;
  }): Promise<Array<{ id: string; billingStatus: string; createdAt: string }>> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('analyses')
        .select('id, billing_status, created_at')
        .eq('user_id', params.userId)
        .neq('billing_status', 'failed')
        .gte('created_at', params.since);

      if (error) {
        console.error('[SupabaseBillingAdapter] getMonthlyAnalyses failed:', error.message);
        throw error;
      }
      return (data || []).map(a => ({
        id: a.id,
        billingStatus: a.billing_status,
        createdAt: a.created_at
      }));
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { method: 'getMonthlyAnalyses' },
        extra: { userId: params.userId, since: params.since },
      });
      throw error;
    }
  }

  static async logUsageEvent(params: {
    userId: string;
    action: string;
    metadata: any;
  }): Promise<void> {
    try {
      const service = getSupabaseServiceClient();
      const { error } = await service
        .from('usage_logs')
        .insert({
          user_id: params.userId,
          action: params.action,
          metadata: params.metadata,
          created_at: new Date().toISOString(),
        });

      if (error) {
        console.error('[SupabaseBillingAdapter] logUsageEvent failed:', error.message);
        throw error;
      }
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { method: 'logUsageEvent' },
        extra: { userId: params.userId, action: params.action },
      });
      throw error;
    }
  }
}
