import { getSupabaseServiceClient } from '@/lib/supabase';
import * as Sentry from '@sentry/nextjs';

export class SupabaseBillingAdapter {
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
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'updateUserTier' },
        extra: { userId: params.userId, tier: params.tier },
      });
      throw error;
    }
  }

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
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'updateBillingStatus' },
        extra: { analysisId: params.analysisId, status: params.status },
      });
      throw error;
    }
  }
}
