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
    const supabase = getSupabaseServiceClient();

    const { data, error } = await supabase.rpc('increment_user_quota_atomic', {
      p_user_id: userId,
    });

    if (error) {
      console.error('[billing] RPC failed:', error);
      return { allowed: false, error: 'Quota check failed' };
    }

    if (!Array.isArray(data) || data.length === 0) {
      console.warn('[billing] Unexpected RPC response format:', data);
      return { allowed: false, error: 'Invalid quota response' };
    }

    const result = data[0];
    const success = result.success === true;

    if (!success) {
      console.warn(`[billing] Monthly quota exceeded for user ${userId}`, {
        newQuota: result.new_quota,
        quotaLimit: result.quota_limit,
        tier: result.tier,
      });

      // Log quota hit for abuse detection (non-blocking)
      try {
        await supabase.from('usage_logs').insert({
          user_id: userId,
          action: 'monthly_quota_exceeded',
          metadata: {
            tier: result.tier,
            usageCount: result.new_quota,
            quotaLimit: result.quota_limit,
            timestamp: new Date().toISOString(),
          },
          created_at: new Date().toISOString(),
        });
      } catch (logErr) {
        console.warn('[billing] Failed to log quota hit:', logErr);
      }

      return {
        allowed: false,
        newQuota: result.new_quota,
        quotaLimit: result.quota_limit,
        error: 'Monthly quota exceeded',
      };
    }

    return {
      allowed: true,
      newQuota: result.new_quota,
      quotaLimit: result.quota_limit,
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
  if (userEmail === ADMIN_EMAIL) return { allowed: true }; // admin is never charged

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
 */
export async function checkMonthlyQuota(
  userId: string,
  tier: Tier,
  userEmail?: string
): Promise<{ allowed: boolean }> {
  if (userEmail === ADMIN_EMAIL) return { allowed: true };
  if (tier === 'pro' || tier === 'enterprise') return { allowed: true };
  
  // Basic check: current usage < limit
  const supabase = getSupabaseServiceClient();
  const { count, error } = await supabase
    .from('analyses')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());

  if (error || count === null) return { allowed: true }; // Fail open
  
  return { allowed: count < (MONTHLY_QUOTAS[tier] || 3) };
}

/**
 * Refund a single monthly quota unit previously consumed by chargeMonthlyQuota.
 *
 * The atomic increment happens at ingestion (before we know a generation can
 * actually run). When ingestion fails — no transcript, metadata fetch error —
 * the user must not be charged for an analysis that never produced output.
 * Call this on every post-charge failure exit.
 *
 * No-op for the admin bypass (admin requests are never charged). Best-effort: a
 * refund failure is logged, never thrown, so it cannot mask the original error
 * being returned to the client.
 */
export async function refundMonthlyQuota(userId: string, userEmail?: string): Promise<void> {
  if (userEmail === ADMIN_EMAIL) return; // admin path never incremented
  try {
    const supabase = getSupabaseServiceClient();
    const { error } = await supabase.rpc('decrement_user_quota', { p_user_id: userId });
    if (error) {
      console.warn('[billing] Refund failed:', error);
      Sentry.captureException(error, {
        tags: { component: 'quota-refund' },
        contexts: { quota: { userId } },
      });
    }
  } catch (err) {
    console.warn('[billing] Refund exception:', err);
    Sentry.captureException(err, { tags: { component: 'quota-refund' } });
  }
}
