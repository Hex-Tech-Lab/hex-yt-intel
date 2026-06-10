import { chargeMonthlyQuota, refundMonthlyQuota } from '@/lib/services/billing';
import type { QuotaGateResult, BillingQuotaPort } from '@/lib/ports';
import type { UserTier } from '@/lib/types/billing';

export class PostgresBillingAdapter implements BillingQuotaPort {
  async checkGate(params: {
    userId: string;
    tier: UserTier;
    email?: string;
    endpoint: 'analyses' | 'search' | 'checkout';
  }): Promise<QuotaGateResult> {
    const { allowed, response } = await chargeMonthlyQuota(
      params.userId,
      params.tier,
      params.email
    );
    return { allowed, denialResponse: response };
  }

  async refund(params: { userId: string; email?: string }): Promise<void> {
    try {
      await refundMonthlyQuota(params.userId, params.email);
    } catch (error) {
      console.error('[PostgresBillingAdapter] refund failed:', error);
    }
  }
}