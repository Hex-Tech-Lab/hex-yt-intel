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
    const { allowed } = await chargeMonthlyQuota(
      params.userId,
      params.tier,
      params.email
    );
    return { allowed };
  }

  async refund(params: { userId: string; email?: string }): Promise<void> {
    try {
      await refundMonthlyQuota(params.userId, params.email);
    } catch (error) {
      console.error('[PostgresBillingAdapter] refund failed:', error);
    }
  }
}