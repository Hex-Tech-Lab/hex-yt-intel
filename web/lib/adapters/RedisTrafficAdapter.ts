import { guardTraffic } from '@/lib/services/traffic';
import type { IQuotaPort, QuotaGateResult } from '@/lib/ports/IQuotaPort';
import type { UserTier } from '@/lib/types/billing';
import type { NextRequest } from 'next/server';

export class RedisTrafficAdapter implements IQuotaPort {
  async checkGate(params: {
    userId: string;
    tier: UserTier;
    email?: string;
    endpoint: 'analyses' | 'search' | 'checkout';
    request?: NextRequest;
  }): Promise<QuotaGateResult> {
    const { allowed, response, headers } = await guardTraffic(
      params.request ?? ({} as NextRequest),
      params.endpoint,
      params.userId,
      params.tier,
      params.email
    );
    return { allowed, denialResponse: response, headers };
  }

  async refund(): Promise<void> {
    // Traffic guard is stateless per-request; no refund needed.
  }
}