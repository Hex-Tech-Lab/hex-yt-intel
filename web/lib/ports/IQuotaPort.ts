import type { NextResponse } from 'next/server';
import type { UserTier } from '@/lib/types/billing';

/** Result of a quota gate check. */
export interface QuotaGateResult {
  /** true = request may proceed; false = a denial response is attached. */
  allowed: boolean;
  /** Pre-built NextResponse to return when denied (429 or 402). */
  denialResponse?: NextResponse;
  /** Rate-limit headers to attach to the success response when allowed. */
  headers?: Record<string, string>;
}

/**
 * Composes the two-stage quota gate:
 *   Stage A — Traffic guard (Redis sliding-window, per-minute DDoS protection)
 *   Stage B — Billing charge (Postgres RPC, monthly quota enforcement)
 *
 * On any post-charge failure (metadata fetch, transcript missing, row insert),
 * the controller MUST call refund() to reverse the charge.
 *
 * Current implementation: guardTraffic() + chargeMonthlyQuota() + refundMonthlyQuota()
 */
export interface IQuotaPort {
  /**
   * Run the two-stage quota gate sequentially.
   * Returns denial on traffic limit (429) or monthly quota exhaustion (402).
   */
  checkGate(params: {
    userId: string;
    tier: UserTier;
    email?: string;
    endpoint: 'analyses' | 'search' | 'checkout';
    clientIp?: string;
    userAgent?: string;
  }): Promise<QuotaGateResult>;

  /**
   * Refund one monthly quota unit. Called on any post-charge ingestion failure.
   * Best-effort: failures are logged, never thrown.
   */
  refund(params: { userId: string; email?: string }): Promise<void>;
}