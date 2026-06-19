import type { QuotaGateResult, BillingQuotaPort, QuotaEndpoint } from '@/lib/ports';
import type { UserTier } from '@/lib/types/billing';
import { SupabasePersistenceAdapter } from './SupabasePersistenceAdapter';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

const MONTHLY_QUOTAS = {
  free: 3,
  pro: null,
  enterprise: null,
} as const;

export class PostgresBillingAdapter implements BillingQuotaPort {
  private persistence = new SupabasePersistenceAdapter();

  async checkGate(params: {
    userId: string;
    tier: UserTier;
    email?: string;
    endpoint: QuotaEndpoint;
  }): Promise<QuotaGateResult> {
    const { userId, tier, email } = params;

    // Admin bypass
    if (
      (ADMIN_EMAIL && email && email === ADMIN_EMAIL) ||
      (process.env.TEST_USER_BYPASS_ID && userId && userId === process.env.TEST_USER_BYPASS_ID)
    ) {
      return { allowed: true };
    }

    if (tier === 'pro' || tier === 'enterprise') {
      return { allowed: true };
    }

    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

    const data = await this.persistence.getMonthlyAnalyses({ userId, since: startOfMonth });
    if (!data) return { allowed: true }; // Fail open

    const activeCount = data.filter((a) => {
      if (a.billingStatus === 'completed') return true;
      if (a.billingStatus === 'processing') {
        const createdTime = new Date(a.createdAt).getTime();
        const fifteenMinutes = 15 * 60 * 1000;
        return Date.now() - createdTime < fifteenMinutes;
      }
      return false;
    }).length;

    const limit = MONTHLY_QUOTAS[tier as 'free'] || 3;
    const allowed = activeCount < limit;

    if (!allowed) {
      // Log quota hit for abuse detection (non-blocking)
      try {
        await this.persistence.logUsageEvent({
          userId,
          action: 'monthly_quota_exceeded',
          metadata: {
            tier,
            quotaLimit: limit,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (logErr) {
        console.warn('[PostgresBillingAdapter] Failed to log quota hit:', logErr);
      }
    }

    return { allowed };
  }

  async consumeQuota(_params: {
    userId: string;
    tier: UserTier;
    email?: string;
  }): Promise<void> {
    // quota charging is handled by inserting stubs and marking billing_status
    // in CreateAnalysisUseCase flow or S2S flows.
  }

  async refund(_params: { userId: string; email?: string }): Promise<void> {
    // NO-OP: Handled inside the bouncer UseCase flow using updateBillingStatus.
  }
}