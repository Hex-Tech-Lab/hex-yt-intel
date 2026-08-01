import type { QuotaGateResult, BillingQuotaPort, QuotaEndpoint } from '@/lib/ports';
import type { UserTier } from '@/lib/types/billing';
import { SupabasePersistenceAdapter } from './SupabasePersistenceAdapter';
import { SupabaseSettingsAdapter } from './SupabaseSettingsAdapter';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

const MONTHLY_QUOTAS = {
  free: 3,
  pro: null,
  enterprise: null,
} as const;

// ADR 020 Phase 2: fallbacks only -- the registry (setting_definitions) is
// the live source of truth, same pattern as dimension-remediation.ts's
// REGISTRY_FALLBACK. Never trust these values directly; always read through
// SupabaseSettingsAdapter.getRegistrySettings.
const REGISTRY_FALLBACK = {
  'billing.chargeOnCancel': true,
  'billing.quota.processingGraceWindowMs': 900_000,
} as const;

export class PostgresBillingAdapter implements BillingQuotaPort {
  private persistence = new SupabasePersistenceAdapter();

  async checkGate(params: {
    userId: string;
    tier: UserTier;
    email?: string;
    endpoint: QuotaEndpoint;
  }): Promise<QuotaGateResult> {
    const { userId, tier, email } = params;

    // Admin bypass
    if (
      (ADMIN_EMAIL && email && email === ADMIN_EMAIL) ||
      (process.env.TEST_USER_BYPASS_ID && userId && userId === process.env.TEST_USER_BYPASS_ID)
    ) {
      return { allowed: true };
    }

    if (tier === 'pro' || tier === 'enterprise') {
      return { allowed: true };
    }

    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

    try {
      const data = await this.persistence.getMonthlyAnalyses({ userId, since: startOfMonth });
      if (!data) return { allowed: true }; // Fail open

      const settings = await SupabaseSettingsAdapter.getRegistrySettings(Object.keys(REGISTRY_FALLBACK), REGISTRY_FALLBACK);
      const chargeOnCancel = Boolean(settings['billing.chargeOnCancel']);
      // NOT `|| fallback` -- 0 is a valid configured value (disable the
      // grace window entirely), and `0 || fallback` would silently discard
      // it back to 900_000. Only NaN (missing/non-numeric) falls back.
      const rawGraceWindow = Number(settings['billing.quota.processingGraceWindowMs']);
      const processingGraceWindowMs = Number.isNaN(rawGraceWindow) ? REGISTRY_FALLBACK['billing.quota.processingGraceWindowMs'] : rawGraceWindow;

      const activeCount = data.filter((a) => {
        if (a.billingStatus === 'completed') return true;
        // ADR 020 Phase 2: a user-cancelled analysis counts against quota
        // too, per the gym-class decision -- but only if the registry
        // setting says so, never hardcoded true.
        if (a.billingStatus === 'cancelled') return chargeOnCancel;
        if (a.billingStatus === 'processing') {
          const createdTime = new Date(a.createdAt).getTime();
          return Date.now() - createdTime < processingGraceWindowMs;
        }
        return false;
      }).length;

      const limit = MONTHLY_QUOTAS[tier as 'free'] || 3;
      const allowed = activeCount < limit;

      if (!allowed) {
        // Log quota hit for abuse detection (non-blocking)
        try {
          await this.persistence.logUsageEvent({
            userId,
            action: 'monthly_quota_exceeded',
            metadata: {
              tier,
              quotaLimit: limit,
              timestamp: new Date().toISOString(),
            },
          });
        } catch (logErr) {
          console.warn('[PostgresBillingAdapter] Failed to log quota hit:', logErr);
        }
      }

      return { allowed };
    } catch (infraErr) {
      // Infrastructure failure during quota check - fail-open (allowed: true)
      console.warn('[PostgresBillingAdapter] Quota check infrastructure failure, failing open:', infraErr);
      return { allowed: true };
    }
  }

  /**
   * Consume quota for completed analysis. Real implementation as of
   * 2026-07-24 (Usage tab work): logs an `analysis_completed` usage event
   * for cost-per-user / tier-usage reporting. This is a pure logging call --
   * it does NOT decrement or gate anything (the live-count `checkGate` query
   * remains the sole quota-enforcement mechanism, untouched here). A logging
   * failure must never propagate to the caller: same try/catch-and-warn
   * shape as the `monthly_quota_exceeded` log above and
   * `SupabaseBillingAdapter.logUsageEvent`'s own Sentry-capture-and-rethrow
   * (rethrows are swallowed right here, not passed up).
   */
  async consumeQuota(params: {
    userId: string;
    tier: UserTier;
    email?: string;
    analysisId?: string;
    tokensUsed?: number;
    costUsd?: number;
  }): Promise<void> {
    try {
      await this.persistence.logUsageEvent({
        userId: params.userId,
        action: 'analysis_completed',
        metadata: {
          tier: params.tier,
          ...(params.analysisId ? { analysisId: params.analysisId } : {}),
          timestamp: new Date().toISOString(),
        },
        tokensUsed: params.tokensUsed,
        costUsd: params.costUsd,
      });
    } catch (logErr) {
      console.warn('[PostgresBillingAdapter] Failed to log analysis_completed usage event:', logErr);
    }
  }

  /**
   * Refund quota for failed analysis
   * Placeholder for future quota refund logic
   */
  refund(): Promise<void> {
    return Promise.resolve();
  }
}