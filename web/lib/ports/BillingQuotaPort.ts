import type { QuotaGateResult, QuotaEndpoint } from './QuotaPort';
import type { UserTier } from '@/lib/types/billing';

/**
 * Handles checking stateful monthly analysis quotas and issuing refunds on ingestion failure.
 */
export interface BillingQuotaPort {
  /**
   * Run the billing quota gate check.
   */
  checkGate(params: {
    userId: string;
    tier: UserTier;
    email?: string;
    endpoint: QuotaEndpoint;
  }): Promise<QuotaGateResult>;

  /**
   * Consume one monthly quota unit (called after successful synthesis).
   */
  consumeQuota(params: {
    userId: string;
    tier: UserTier;
    email?: string;
  }): Promise<void>;

  /**
   * Refund one monthly quota unit. Called on post-charge ingestion failure.
   */
  refund(params: { userId: string; email?: string }): Promise<void>;
}
