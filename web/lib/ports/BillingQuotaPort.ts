import type { QuotaGateResult } from './QuotaPort';
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
    endpoint: 'analyses' | 'search' | 'checkout';
  }): Promise<QuotaGateResult>;

  /**
   * Refund one monthly quota unit. Called on post-charge ingestion failure.
   */
  refund(params: { userId: string; email?: string }): Promise<void>;
}
