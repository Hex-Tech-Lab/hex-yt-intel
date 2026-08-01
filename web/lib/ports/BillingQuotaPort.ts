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
   * `analysisId` is optional and additive (added 2026-07-24 for usage-log
   * tagging) -- existing/future callers that omit it are unaffected.
   */
  consumeQuota(params: {
    userId: string;
    tier: UserTier;
    email?: string;
    analysisId?: string;
    // ADR 020 Phase 3: real OpenRouter usage/cost, logged onto the same
    // analysis_completed usage_logs row -- optional/additive like analysisId.
    tokensUsed?: number;
    costUsd?: number;
  }): Promise<void>;

  /**
   * Refund one monthly quota unit. Called on post-charge ingestion failure.
   */
  refund(params: { userId: string; email?: string }): Promise<void>;
}
