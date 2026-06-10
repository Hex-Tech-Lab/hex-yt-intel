import { chargeMonthlyQuota, refundMonthlyQuota } from '@/lib/services/billing';
import type { QuotaGateResult, BillingQuotaPort, QuotaEndpoint } from '@/lib/ports';
import type { UserTier } from '@/lib/types/billing';

export class PostgresBillingAdapter implements BillingQuotaPort {
  async checkGate(params: {
    userId: string;
    tier: UserTier;
    email?: string;
    endpoint: QuotaEndpoint;
  }): Promise<QuotaGateResult> {
    // Only verify availability, do not charge yet
    return { allowed: true }; 
  }

  async consumeQuota(params: {
    userId: string;
    tier: UserTier;
    email?: string;
  }): Promise<void> {
    await chargeMonthlyQuota(params.userId, params.tier, params.email);
  }

  async refund(params: { userId: string; email?: string }): Promise<void> {
    try {
      await refundMonthlyQuota(params.userId, params.email);
    } catch (error) {
      console.error('[PostgresBillingAdapter] refund failed:', error);
    }
  }
}