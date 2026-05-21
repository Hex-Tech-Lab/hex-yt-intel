export const dynamic = 'force-dynamic';

/**
 * Rate Limit Status Endpoint
 * GET /api/rate-limit-status
 *
 * Returns the current rate limit status for the authenticated user
 * Allows frontend to display remaining quota and reset times
 *
 * Response:
 * {
 *   analyses: {
 *     remaining: number;
 *     limit: number;
 *     resetAt: string (ISO 8601);
 *     retryAfter: number;
 *     tier: string;
 *   };
 *   search: {
 *     remaining: number;
 *     limit: number;
 *     resetAt: string (ISO 8601);
 *     retryAfter: number;
 *     tier: string;
 *   };
 *   tier: string;
 *   description: string;
 * }
 */

import { getAuthSession } from '@/lib/auth/provider-factory';
import { NextRequest, NextResponse } from 'next/server';
import { getRateLimitStatus, getUserTier, RATE_LIMITS } from '@/lib/rate-limit';
import * as Sentry from '@sentry/nextjs';

interface RateLimitStatusResponse {
  analyses: {
    remaining: number;
    limit: number;
    resetAt: string;
    retryAfter: number;
    tier: string;
  };
  search: {
    remaining: number;
    limit: number;
    resetAt: string;
    retryAfter: number;
    tier: string;
  };
  tier: string;
  description: string;
}

export async function GET(_request: NextRequest) {
  try {
    // 1. Auth check
    const session = await getAuthSession();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = (session.user as any).id;

    // 2. Get user tier
    const tier = await getUserTier(userId);
    const tierConfig = RATE_LIMITS[tier];

    // 3. Get rate limit status for both endpoints
    const analysesStatus = await getRateLimitStatus(userId, tier, 'analyses');
    const searchStatus = await getRateLimitStatus(userId, tier, 'search');

    // 4. Format response
    const response: RateLimitStatusResponse = {
      analyses: {
        remaining: analysesStatus.remaining,
        limit: analysesStatus.limit,
        resetAt: new Date(analysesStatus.resetAt).toISOString(),
        retryAfter: analysesStatus.retryAfter,
        tier,
      },
      search: {
        remaining: searchStatus.remaining,
        limit: searchStatus.limit,
        resetAt: new Date(searchStatus.resetAt).toISOString(),
        retryAfter: searchStatus.retryAfter,
        tier,
      },
      tier,
      description: tierConfig.description,
    };

    // 5. Add rate limit headers
    const jsonResponse = NextResponse.json(response, { status: 200 });
    jsonResponse.headers.set('X-RateLimit-Limit', String(tierConfig.requestsPerMinute));
    jsonResponse.headers.set('X-RateLimit-Remaining', String(analysesStatus.remaining));
    jsonResponse.headers.set('X-RateLimit-Reset', String(analysesStatus.resetAt));

    return jsonResponse;
  } catch (error) {
    console.error('[/api/rate-limit-status] Error:', error);
    Sentry.captureException(error, {
      contexts: {
        api: {
          endpoint: '/api/rate-limit-status',
          method: 'GET',
        },
      },
      tags: {
        endpoint: 'rate-limit-status',
        severity: 'medium',
      },
    });

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
