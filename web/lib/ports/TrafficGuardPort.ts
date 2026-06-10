import type { QuotaGateResult } from './QuotaPort';
import type { UserTier } from '@/lib/types/billing';

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
  }): Promise<QuotaGateResult>;
}
