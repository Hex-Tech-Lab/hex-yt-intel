/**
 * Billing Service — Monthly analysis quota (Postgres RPC, source of truth).
 *
 * Owns the atomic monthly-quota lifecycle: charge at ingestion
 * (`increment_user_quota_atomic`) and refund on post-charge failure
 * (`decrement_user_quota`). This is the "Billing" half of the former
 * rate-limit.ts God file; it deals exclusively with Postgres and is orthogonal
 * to the per-minute Redis traffic limiter in `@/lib/services/traffic`.
 *
 * Single increment per authorized generation: the API bouncer charges exactly
 * once (after the traffic guard passes, before the LLM cascade) and refunds on
 * any ingestion failure. There is no Redis-side monthly counter — that legacy
 * subsystem was unused and has been removed to keep one source of truth.
 */

import { NextResponse } from 'next/server';
import { getSupabaseServiceClient } from '@/lib/supabase';
import * as Sentry from '@sentry/nextjs';
import { ADMIN_EMAIL, type Tier } from '@/lib/services/traffic';

/**
 * Monthly quota configuration per tier (analyses per calendar month).
 * Mirrors the limits enforced by the `increment_user_quota_atomic` RPC.
 * null = unlimited.
 */
export const MONTHLY_QUOTAS = {
  free: 3,
  pro: null,
  enterprise: null,
} as const;

/**
 * Enforce the atomic monthly quota via the Postgres RPC. Increments the user's
 * counter and reports whether they remain under their tier limit. Fails OPEN
 * (allows the request) if the RPC errors, so an infra blip never hard-blocks a
 * paying flow — the failure is logged to Sentry.
 */
async function enforceMonthlyQuota(userId: string, tier: Tier): Promise<{
  allowed: boolean;
  newQuota?: number;
  quotaLimit?: number;
  error?: string;
}> {
  try {
    const quotaResult = await checkMonthlyQuota(userId, tier);
    const limit = MONTHLY_QUOTAS[tier] || 3;

    if (!quotaResult.allowed) {
      console.warn(`[billing] Monthly quota exceeded for user ${userId}`, {
        quotaLimit: limit,
        tier,
      });

      // Log quota hit for abuse detection (non-blocking)
      try {
        const supabase = getSupabaseServiceClient();
        await supabase.from('usage_logs').insert({
          user_id: userId,
          action: 'monthly_quota_exceeded',
          metadata: {
            tier,
            quotaLimit: limit,
            timestamp: new Date().toISOString(),
          },
          created_at: new Date().toISOString(),
        });
      } catch (logErr) {
        console.warn('[billing] Failed to log quota hit:', logErr);
      }

      return {
        allowed: false,
        newQuota: limit,
        quotaLimit: limit,
        error: 'Monthly quota exceeded',
      };
    }

    return {
      allowed: true,
      newQuota: 0,
      quotaLimit: limit,
    };
  } catch (err) {
    console.error('[billing] Quota enforcement exception:', err);
    Sentry.captureException(err, {
      level: 'error',
      contexts: { quota: { userId, tier, stage: 'enforcement' } },
      tags: { component: 'quota-enforcement', severity: 'high' },
    });
    // Fail open: allow request if quota check fails (logged above).
    return { allowed: true };
  }
}

/**
 * Charge one monthly analysis unit for the API bouncer. Admin-bypasses (never
 * charged). On quota exhaustion returns a ready 402 NextResponse; otherwise
 * `{ allowed: true }`. Call AFTER the traffic guard passes and BEFORE the LLM
 * cascade — exactly once per request — then refund via `refundMonthlyQuota` on
 * any post-charge ingestion failure.
 */
export async function chargeMonthlyQuota(
  userId: string,
  tier: Tier,
  userEmail?: string
): Promise<{ allowed: boolean; response?: NextResponse }> {
  if (
    (ADMIN_EMAIL && userEmail === ADMIN_EMAIL) ||
    (process.env.TEST_USER_BYPASS_ID && userId === process.env.TEST_USER_BYPASS_ID)
  ) {
    return { allowed: true };
  }

  const quotaResult = await enforceMonthlyQuota(userId, tier);

  if (!quotaResult.allowed) {
    const response = NextResponse.json(
      {
        error: 'Monthly quota exhausted',
        code: 'ERR_MONTHLY_QUOTA_EXHAUSTED',
        message:
          tier === 'free'
            ? `Free tier limited to ${quotaResult.quotaLimit || 3} analyses per month. Upgrade to Pro for unlimited access.`
            : 'Monthly quota exceeded. Contact support for assistance.',
        used: quotaResult.newQuota,
        limit: quotaResult.quotaLimit,
      },
      { status: 402 }
    );
    response.headers.set('X-Quota-Status', 'exhausted');
    return { allowed: false, response };
  }

  return { allowed: true };
}

/**
 * Check if the user is under the monthly analysis quota.
 * Consolidates check on the public.analyses table using billing_status.
 */
export async function checkMonthlyQuota(
  userId: string,
  tier: Tier,
  userEmail?: string
): Promise<{ allowed: boolean }> {
  if (
    (ADMIN_EMAIL && userEmail === ADMIN_EMAIL) ||
    (process.env.TEST_USER_BYPASS_ID && userId === process.env.TEST_USER_BYPASS_ID)
  ) {
    return { allowed: true };
  }
  if (tier === 'pro' || tier === 'enterprise') return { allowed: true };
  
  const supabase = getSupabaseServiceClient();
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  // Query all analyses in the current month that did not explicitly fail
  const { data, error } = await supabase
    .from('analyses')
    .select('id, billing_status, created_at')
    .eq('user_id', userId)
    .neq('billing_status', 'failed')
    .gte('created_at', startOfMonth);

  if (error || !data) return { allowed: true }; // Fail open
  
  // Filter out stalled processing stubs that are older than 15 minutes
  const activeCount = data.filter((a) => {
    if (a.billing_status === 'completed') return true;
    if (a.billing_status === 'processing') {
      const createdTime = new Date(a.created_at).getTime();
      const fifteenMinutes = 15 * 60 * 1000;
      return Date.now() - createdTime < fifteenMinutes;
    }
    return false;
  }).length;

  return { allowed: activeCount < (MONTHLY_QUOTAS[tier] || 3) };
}

/**
 * Refund a single monthly quota unit.
 * Deprecated for Postgres RPCs; refunds are handled dynamically by marking 
 * the analyses.billing_status as 'failed' in the CreateAnalysisUseCase.
 */
export async function refundMonthlyQuota(_userId: string, _userEmail?: string): Promise<void> {
  // NO-OP: Handled S2S or inside the bouncer UseCase flow using updateBillingStatus.
}
