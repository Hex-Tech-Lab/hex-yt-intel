/**
 * Traffic Service — Per-minute DDoS / abuse protection (Upstash Redis).
 *
 * Coordinates request cadence checking. Monthly billing/quota lives
 * in `@/lib/services/billing` (Postgres RPC) and is orthogonal.
 */

import { NextResponse } from 'next/server';
import type { TrafficGuardPort, RateLimitStatus } from '@/lib/ports';
import { RATE_LIMITS } from '@/lib/constants/rate-limits';
import type { Tier, Endpoint } from '@/lib/constants/rate-limits';
import { RedisTrafficAdapter } from '../adapters/RedisTrafficAdapter';
import { SupabasePersistenceAdapter } from '../adapters/SupabasePersistenceAdapter';

/** Admin account exempt from traffic limits and billing charges. */
export function isValidAdminEmail(email: string | undefined): boolean {
  if (!email) return false;
  const trimmed = email.trim();
  if (trimmed.length === 0) return false;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return false;
  const normalized = trimmed.toLowerCase();
  return !(normalized.includes('placeholder') || normalized.includes('dummy') || normalized.includes('stub') || normalized.includes('ci-build'));
}

export const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

export async function getUserTier(userId: string): Promise<Tier> {
  try {
    const persistence = new SupabasePersistenceAdapter();
    const profile = await persistence.getUserProfile(userId);

    if (!profile) {
      console.warn(`[traffic] Failed to get tier for user ${userId}: profile not found`);
      return 'free';
    }

    const tier = profile.tier as Tier;
    if (!RATE_LIMITS[tier]) {
      console.warn(`[traffic] Unknown tier for user ${userId}: ${tier}, defaulting to free`);
      return 'free';
    }
    return tier;
  } catch (error) {
    console.warn(`[traffic] Error fetching user tier:`, error);
    return 'free';
  }
}

/** HTTP headers assignment utility (RFC 6585 compliance). */
export function applyRateLimitHeaders(response: NextResponse, status: RateLimitStatus): void {
  const resetAtSeconds = Math.ceil(status.resetAt / 1000);
  response.headers.set('X-RateLimit-Limit', String(status.limit));
  response.headers.set('X-RateLimit-Remaining', String(status.remaining));
  response.headers.set('X-RateLimit-Reset', String(resetAtSeconds));
  // Backward compatibility for existing E2E tests
  response.headers.set('X-Quota-Remaining', String(status.remaining));
}

/**
 * Traffic guard for the API bouncer. Admin-bypasses, then enforces the
 * per-minute sliding window. On denial returns a ready 429 NextResponse; on
 * success returns the rate-limit headers for the caller to attach. Does NOT
 * touch billing.
 */
export async function guardTraffic(
  endpoint: Endpoint,
  userId: string,
  tier: Tier,
  userEmail?: string,
  clientIp?: string,
  userAgent?: string,
  trafficGuard: TrafficGuardPort = new RedisTrafficAdapter()
): Promise<{ allowed: boolean; response?: NextResponse; headers?: Record<string, string> }> {
  // Admin bypass: grant immediate access, skip the limiter entirely.
  if ((isValidAdminEmail(ADMIN_EMAIL) && userEmail && userEmail.toLowerCase() === ADMIN_EMAIL!.toLowerCase()) || (process.env.TEST_USER_BYPASS_ID && userId && userId === process.env.TEST_USER_BYPASS_ID)) {
    return { allowed: true, headers: { 'X-RateLimit-Admin': 'bypassed' } };
  }

  const { allowed, status } = await trafficGuard.checkGate({
    userId,
    tier,
    email: userEmail,
    endpoint,
    clientIp,
    userAgent,
  });

  if (!allowed && status) {
    const response = NextResponse.json(
      {
        error: 'Rate limit exceeded',
        message: `Too many requests. Current tier: ${tier}. ${RATE_LIMITS[tier].description}`,
        retryAfter: status.retryAfter,
        resetAt: new Date(status.resetAt).toISOString(),
      },
      { status: 429 }
    );
    applyRateLimitHeaders(response, status);
    response.headers.set('Retry-After', String(status.retryAfter));
    return { allowed: false, response };
  }

  if (status) {
    const resetAtSeconds = Math.ceil(status.resetAt / 1000);
    return {
      allowed: true,
      headers: {
        'X-RateLimit-Limit': String(status.limit),
        'X-RateLimit-Remaining': String(status.remaining),
        'X-RateLimit-Reset': String(resetAtSeconds),
      },
    };
  }

  return { allowed: true };
}

/** Current rate-limit status for a user (used by /api/rate-limit-status). */
export async function getRateLimitStatus(
  userId: string,
  tier: Tier,
  endpoint: Endpoint,
  trafficGuard: TrafficGuardPort = new RedisTrafficAdapter()
): Promise<RateLimitStatus> {
  return trafficGuard.getRateLimitStatus({ userId, tier, endpoint });
}

export async function checkRateLimitSlidingWindow(
  userId: string,
  tier: Tier,
  endpoint: Endpoint,
  trafficGuard: TrafficGuardPort = new RedisTrafficAdapter()
): Promise<{ allowed: boolean; status: RateLimitStatus }> {
  const { allowed, status } = await trafficGuard.checkGate({
    userId,
    tier,
    endpoint,
  });
  return {
    allowed: allowed ?? true,
    status: status ?? {
      remaining: -1,
      limit: RATE_LIMITS[tier].requestsPerMinute,
      resetAt: Date.now() + 60000,
      retryAfter: 60,
      tier,
      requestTime: 0,
    },
  };
}

export { RATE_LIMITS, type Tier, type Endpoint };