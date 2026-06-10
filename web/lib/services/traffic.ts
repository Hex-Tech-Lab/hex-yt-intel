/**
 * Traffic Service — Per-minute DDoS / abuse protection (Upstash Redis).
 *
 * Owns the sliding-window rate limiter and its supporting status/headers/tier
 * lookup. This is the "Traffic" half of the former rate-limit.ts God file; it
 * deals exclusively with Redis and request cadence. Monthly billing/quota lives
 * in `@/lib/services/billing` (Postgres RPC) and is orthogonal — the API bouncer
 * composes the two sequentially (traffic guard first, then billing charge).
 *
 * Algorithm: Redis Sorted Set with millisecond-precision timestamps + unique
 * members. Atomic Lua execution removes the burst-leak race. Fails OPEN if Redis
 * is unavailable (availability > strictness for a free-tier abuse control).
 */

import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getSupabaseServiceClient } from '@/lib/supabase';
import { getRedisValue, incrementRedisValue, setRedisExpiration, executeRedisScript } from '@/lib/redis';
import * as Sentry from '@sentry/nextjs';

/** Admin account exempt from traffic limits and billing charges. */
export const ADMIN_EMAIL = 'kellybakri@gmail.com';

/**
 * Rate limit configuration per tier. Expressed as requests per minute.
 */
export const RATE_LIMITS = {
  free: {
    requestsPerMinute: 3,
    requestsPerHour: 50,
    description: 'Free tier: 3 requests/minute, 50/hour',
  },
  pro: {
    requestsPerMinute: 30,
    requestsPerHour: 500,
    description: 'Pro tier: 30 requests/minute, 500/hour',
  },
  enterprise: {
    requestsPerMinute: 300,
    requestsPerHour: 10000,
    description: 'Enterprise tier: unlimited (300 req/min soft limit)',
  },
} as const;

export type Tier = keyof typeof RATE_LIMITS;
export type Endpoint = 'analyses' | 'search' | 'checkout';

/** Rate limit status returned to the client. */
export interface RateLimitStatus {
  remaining: number;
  limit: number;
  resetAt: number; // Unix timestamp in milliseconds
  retryAfter: number; // Seconds to wait before next request
  tier: string;
  requestTime: number; // Current request count in window
}

/**
 * Parse Redis values to numbers safely, eliminating string-to-number coercion
 * bugs. Redis stores all values as strings.
 */
export function parseRedisNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const num = Number(value);
  return isNaN(num) ? 0 : num;
}

/**
 * Sliding-window counter via Redis Sorted Set (atomic Lua).
 *   KEYS[1] redis key | ARGV[1] now(ms) | ARGV[2] window(ms) | ARGV[3] limit
 *   ARGV[4] ttl(s) | ARGV[5] unique member
 * Returns { allowed, count }.
 */
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local member = ARGV[5]

-- Remove timestamps older than window
local cutoff = now - window
redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)

-- Count remaining requests in window
local count = redis.call('ZCARD', key)

-- Determine if request is allowed
local allowed = 0
if count < limit then
  redis.call('ZADD', key, now, member)
  count = count + 1
  allowed = 1
end

-- Refresh TTL
redis.call('EXPIRE', key, ttl)

-- Return { allowed, count } tuple
return { allowed, count }
`;

/** Centralized graceful degradation response (fail-open pattern). */
function gracefulDegradation(tier: Tier, limitPerMinute: number): RateLimitStatus {
  return {
    remaining: -1,
    limit: limitPerMinute,
    resetAt: Date.now() + 60000,
    retryAfter: 60,
    tier,
    requestTime: 0,
  };
}

/** Unified rate limit event logger (Sentry message + breadcrumb). */
function logRateLimitEvent(
  userId: string,
  tier: string,
  endpoint: string,
  requestCount: number,
  limit: number,
  eventType: 'exceeded' | 'threshold'
): void {
  const message = eventType === 'exceeded'
    ? `Rate limit exceeded: ${tier} tier on ${endpoint}`
    : `User at rate limit threshold`;

  Sentry.captureMessage(message, 'warning');
  Sentry.addBreadcrumb({
    category: 'rate-limit',
    message,
    level: 'warning',
    data: { userId, tier, endpoint, requestCount, limit },
  });
}

function getRateLimit(tier: Tier): number {
  return RATE_LIMITS[tier].requestsPerMinute;
}

/**
 * Log a rate-limit hit to usage_logs for abuse detection. Non-blocking.
 */
async function logRateLimitHit(
  userId: string,
  endpoint: string,
  tier: string,
  requestCount: number,
  limit: number
): Promise<void> {
  try {
    const supabase = getSupabaseServiceClient();
    await supabase.from('usage_logs').insert({
      user_id: userId,
      action: 'rate_limit_exceeded',
      metadata: { endpoint, tier, requestCount, limit, timestamp: new Date().toISOString() },
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('[traffic] Failed to log rate limit hit:', error);
  }
}

/**
 * Check rate limit using the sliding-window counter (atomic Lua execution).
 * Returns { allowed, status } with an accurate remaining count.
 */
export async function checkRateLimitSlidingWindow(
  userId: string,
  tier: Tier,
  endpoint: Endpoint
): Promise<{ allowed: boolean; status: RateLimitStatus }> {
  const limitPerMinute = getRateLimit(tier);
  const now = Date.now();
  const uniqueMember = `${now}:${randomUUID()}`;
  const redisKey = `ratelimit:${userId}:${endpoint}:sliding`;

  try {
    const luaResult = await executeRedisScript(SLIDING_WINDOW_SCRIPT, [redisKey], [
      now,
      60000, // 60-second window in milliseconds
      limitPerMinute,
      90, // TTL in seconds
      uniqueMember,
    ]);

    // Sentinel guard: if Redis unavailable, luaResult is -1
    if (luaResult === -1) {
      const status = gracefulDegradation(tier, limitPerMinute);
      status.requestTime = -1;
      return { allowed: true, status };
    }

    if (!Array.isArray(luaResult) || luaResult.length !== 2) {
      throw new Error(`Unexpected Redis Lua response array format: ${JSON.stringify(luaResult)}`);
    }
    const [allowedFlag, requestCount] = luaResult;
    const allowed = allowedFlag === 1;

    if (!allowed) {
      await logRateLimitHit(userId, endpoint, tier, requestCount, limitPerMinute);
      logRateLimitEvent(userId, tier, endpoint, requestCount, limitPerMinute, 'exceeded');
    } else if (requestCount === limitPerMinute) {
      logRateLimitEvent(userId, tier, endpoint, requestCount, limitPerMinute, 'threshold');
    }

    const resetAt = now + 60000;
    const retryAfter = 60;

    const status: RateLimitStatus = {
      remaining: Math.max(0, limitPerMinute - requestCount),
      limit: limitPerMinute,
      resetAt,
      retryAfter,
      tier,
      requestTime: requestCount,
    };

    return { allowed, status };
  } catch (error) {
    console.error(`[traffic] Sliding window execution failed for user ${userId}:`, error);
    Sentry.captureException(error, {
      level: 'error',
      contexts: { rateLimit: { userId, endpoint, tier, algorithm: 'sliding-window', window: '60s' } },
      tags: { component: 'rate-limiter', severity: 'high', failureMode: 'redis-unavailable' },
    });
    return { allowed: true, status: gracefulDegradation(tier, limitPerMinute) };
  }
}

/**
 * Legacy per-minute fixed-window check (INCR + EXPIRE). Retained to back
 * getRateLimitStatus, which reports remaining quota to the client.
 */
export async function checkRateLimit(
  userId: string,
  tier: Tier,
  endpoint: Endpoint
): Promise<{ allowed: boolean; status: RateLimitStatus }> {
  const limitPerMinute = getRateLimit(tier);
  const now = Math.floor(Date.now() / 1000);
  const minuteWindow = Math.floor(now / 60);
  const redisKey = `ratelimit:${userId}:${endpoint}:${minuteWindow}`;

  try {
    const redisValue = await getRedisValue(redisKey);
    const requestCount = parseRedisNumber(redisValue);
    const allowed = requestCount < limitPerMinute;

    if (!allowed) {
      await logRateLimitHit(userId, endpoint, tier, requestCount, limitPerMinute);
    }
    if (allowed) {
      await incrementRedisValue(redisKey, 1);
    }
    if (requestCount === 0) {
      await setRedisExpiration(redisKey, 60);
    }

    const nextMinute = (minuteWindow + 1) * 60;
    const resetAt = nextMinute * 1000;
    const retryAfter = Math.max(1, nextMinute - now);

    const status: RateLimitStatus = {
      remaining: Math.max(0, limitPerMinute - (requestCount + 1)),
      limit: limitPerMinute,
      resetAt,
      retryAfter,
      tier,
      requestTime: requestCount + 1,
    };

    return { allowed, status };
  } catch (error) {
    console.error(`[traffic] Error checking rate limit for user ${userId}:`, error);
    Sentry.captureException(error, {
      contexts: { rateLimit: { userId, endpoint, tier } },
      tags: { severity: 'medium' },
    });
    return { allowed: true, status: gracefulDegradation(tier, limitPerMinute) };
  }
}

/** Current rate-limit status for a user (used by /api/rate-limit-status). */
export async function getRateLimitStatus(
  userId: string,
  tier: Tier,
  endpoint: Endpoint
): Promise<RateLimitStatus> {
  const { status } = await checkRateLimit(userId, tier, endpoint);
  return status;
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

/** Resolve a user's subscription tier from the users table. Defaults to free. */
export async function getUserTier(userId: string): Promise<Tier> {
  try {
    const { getSupabaseClientWithAuth } = await import('@/lib/supabase');
    const supabase = await getSupabaseClientWithAuth();

    const { data, error } = await supabase
      .from('users')
      .select('tier')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) {
      console.warn(`[traffic] Failed to get tier for user ${userId}:`, error);
      return 'free';
    }

    const tier = data.tier as Tier;
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

/**
 * Traffic guard for the API bouncer. Admin-bypasses, then enforces the
 * per-minute sliding window. On denial returns a ready 429 NextResponse; on
 * success returns the rate-limit headers for the caller to attach. Does NOT
 * touch billing — compose with `chargeMonthlyQuota` from the billing service.
 */
export async function guardTraffic(
  endpoint: Endpoint,
  userId: string,
  tier: Tier,
  userEmail?: string,
  _clientIp?: string,
  _userAgent?: string
): Promise<{ allowed: boolean; response?: NextResponse; headers?: Record<string, string> }> {
  // Admin bypass: grant immediate access, skip the limiter entirely.
  if (userEmail === ADMIN_EMAIL || userId === 'da4381c6-f774-4c99-8f04-2c1c9e27d1fb') {
    return { allowed: true, headers: { 'X-RateLimit-Admin': 'bypassed' } };
  }

  const { allowed, status } = await checkRateLimitSlidingWindow(userId, tier, endpoint);

  if (!allowed) {
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
