import { guardTraffic } from '@/lib/services/traffic';
import type { QuotaGateResult, TrafficGuardPort } from '@/lib/ports';
import type { UserTier } from '@/lib/types/billing';

export class RedisTrafficAdapter implements TrafficGuardPort {
  async checkGate(params: {
    userId: string;
    tier: UserTier;
    email?: string;
    endpoint: 'analyses' | 'search' | 'checkout';
    clientIp?: string;
    userAgent?: string;
  }): Promise<QuotaGateResult> {
    const { allowed, response, headers } = await guardTraffic(
      params.endpoint,
      params.userId,
      params.tier,
      params.email,
      params.clientIp,
      params.userAgent
    );
    return { allowed, denialResponse: response, headers };
  }
}