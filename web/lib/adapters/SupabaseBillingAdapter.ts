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
    status: 'processing' | 'completed' | 'failed' | 'cancelled';
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

  /**
   * Count usage_logs rows by action for a user since a given timestamp,
   * grouped by `metadata.surface` when present (chat turns are tagged
   * 'synthesis_console' | 'atlas'; other actions have no surface tag).
   * Used by the Usage tab / GET /api/usage/summary -- read-only, no
   * dependency on any specific writer having run (returns zeros if the
   * table is simply empty for this user, never throws for that case).
   */
  static async getUsageEventCounts(params: {
    userId: string;
    since: string;
  }): Promise<Array<{ action: string; surface: string | null; count: number; costUsd: number }>> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('usage_logs')
        .select('action, metadata, cost_usd')
        .eq('user_id', params.userId)
        .gte('created_at', params.since);

      if (error) {
        console.error('[SupabaseBillingAdapter] getUsageEventCounts failed:', error.message);
        throw error;
      }

      const grouped = new Map<string, { action: string; surface: string | null; count: number; costUsd: number }>();
      for (const row of data || []) {
        const surface = (row.metadata as { surface?: string } | null)?.surface ?? null;
        const key = `${row.action}:${surface ?? ''}`;
        const existing = grouped.get(key) ?? { action: row.action, surface, count: 0, costUsd: 0 };
        existing.count += 1;
        existing.costUsd += Number(row.cost_usd) || 0;
        grouped.set(key, existing);
      }
      return Array.from(grouped.values());
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { method: 'getUsageEventCounts' },
        extra: { userId: params.userId, since: params.since },
      });
      throw error;
    }
  }

  static async logUsageEvent(params: {
    userId: string;
    action: string;
    metadata: any;
    // ADR 020 Phase 3: real OpenRouter usage/cost for the per-user cost
    // ledger. usage_logs is append-only (one row per analysis completion),
    // so no accumulation/race handling is needed -- the admin cost list
    // just SUMs cost_usd grouped by user_id.
    tokensUsed?: number;
    costUsd?: number;
  }): Promise<void> {
    try {
      const service = getSupabaseServiceClient();
      const { error } = await service
        .from('usage_logs')
        .insert({
          user_id: params.userId,
          action: params.action,
          metadata: params.metadata,
          tokens_used: params.tokensUsed ?? 0,
          cost_usd: params.costUsd ?? 0,
          created_at: new Date().toISOString(),
        });

      if (error) {
        // ADR 020 Phase 3 review fix: idx_usage_logs_analysis_completed_dedup
        // (unique on metadata->>'analysisId' where action='analysis_completed')
        // rejects a second cost-log row for an analysisId that already has
        // one -- expected and benign when the worker retries a persist call
        // whose response was lost after the DB write already succeeded, not
        // a real failure worth Sentry noise or a caller-visible throw.
        if (error.code === '23505') {
          console.debug('[SupabaseBillingAdapter] logUsageEvent: duplicate analysis_completed event ignored', { userId: params.userId, action: params.action });
          return;
        }
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
