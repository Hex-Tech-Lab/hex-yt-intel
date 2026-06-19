import type { QuotaGateResult } from './QuotaPort';
import type { UserTier } from '@/lib/types/billing';

export interface RateLimitStatus {
  remaining: number;
  limit: number;
  resetAt: number; // Unix timestamp in milliseconds
  retryAfter: number; // Seconds to wait before next request
  tier: string;
  requestTime: number; // Current request count in window
}

/**
 * Handles checking stateless per-minute DDoS traffic limits (e.g. via Redis).
 */
export interface TrafficGuardPort {
  /**
   * Run the traffic gate check.
   */
  checkGate(params: {
    userId: string;
    tier: UserTier;
    email?: string;
    endpoint: 'analyses' | 'search' | 'checkout';
    clientIp?: string;
    userAgent?: string;
  }): Promise<QuotaGateResult & { status?: RateLimitStatus }>;

  /**
   * Get current rate limit status for a user/endpoint.
   */
  getRateLimitStatus(params: {
    userId: string;
    tier: UserTier;
    endpoint: 'analyses' | 'search' | 'checkout';
  }): Promise<RateLimitStatus>;
}
