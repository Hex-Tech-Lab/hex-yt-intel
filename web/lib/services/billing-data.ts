import { getBillingProvider } from '@lib/billing-factory';
import { stripe, STRIPE_PRICING } from '@lib/stripe';
import { SupabasePersistenceAdapter } from '@lib/adapters/SupabasePersistenceAdapter';
import { normalizeUserTier } from '@lib/types/billing';
import { MONTHLY_QUOTAS } from '@lib/adapters/PostgresBillingAdapter';
import type { UserTier } from '@lib/types/billing';

/**
 * BILLING DATA CONSOLIDATION LAW (2026-06-08)
 * -------------------------------------------
 * Unified service to fetch billing data regardless of active provider.
 * Prevents "toe-stepping" by providing a single source for GCT's UI.
 */

export interface UnifiedBillingData {
  tier: UserTier;
  analysesUsed: number;
  analysesLimit: number | null;
  usageStats: Record<string, number>;
  invoices: any[];
}

export async function fetchUnifiedBillingData(userId: string): Promise<UnifiedBillingData> {
  const persistence = new SupabasePersistenceAdapter();
  const provider = getBillingProvider();

  // 1. Core User Data
  const userData = await persistence.getUserBillingConfig(userId);

  if (!userData) throw new Error('User not found');

  // 2. Usage Stats (Last 30 days)
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
const usageLogCount = await persistence.getUsageLogsCountSince({ userId, since });

   const usageStats = {
     all: usageLogCount
   };

  // 3. Provider-specific Invoice logic
  let invoices: any[] = [];
  
  if (provider.type === 'stripe' && userData.stripeCustomerId) {
    const stripeInvoices = await stripe.invoices.list({ customer: userData.stripeCustomerId, limit: 5 });
    invoices = stripeInvoices.data.map(inv => ({
      id: inv.id,
      amount: inv.amount_paid,
      status: inv.status,
      date: new Date(inv.created * 1000).toISOString(),
      url: inv.hosted_invoice_url
    }));
  } else if (provider.type === 'paddle') {
    // Paddle invoice fetching (Placeholder until customer mapping is finalized)
    invoices = []; 
  }

  const tier = normalizeUserTier(userData.tier);
  // No Free fallback: every UserTier now has a STRIPE_PRICING entry
  // (CodeRabbit review, 2026-09-24) -- analysesLimit reads the shared
  // MONTHLY_QUOTAS map so display and the quota gate can't drift.
  const tierConfig = STRIPE_PRICING[tier as keyof typeof STRIPE_PRICING];

  return {
    tier,
    analysesUsed: userData.analysesUsed || 0,
    analysesLimit: tierConfig.analysesPerMonth ?? MONTHLY_QUOTAS[tier],
    usageStats,
    invoices
  };
}
