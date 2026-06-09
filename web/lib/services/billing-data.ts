import { getBillingProvider } from '../billing-factory';
import { stripe, STRIPE_PRICING } from '../stripe';
import { getSupabaseServiceClient } from '../supabase';

/**
 * BILLING DATA CONSOLIDATION LAW (2026-06-08)
 * -------------------------------------------
 * Unified service to fetch billing data regardless of active provider.
 * Prevents "toe-stepping" by providing a single source for GCT's UI.
 */

export interface UnifiedBillingData {
  tier: 'free' | 'pro' | 'enterprise';
  analysesUsed: number;
  analysesLimit: number | null;
  usageStats: Record<string, number>;
  invoices: any[];
}

export async function fetchUnifiedBillingData(userId: string): Promise<UnifiedBillingData> {
  const supabase = getSupabaseServiceClient();
  const provider = getBillingProvider();

  // 1. Core User Data
  const { data: userData } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (!userData) throw new Error('User not found');

  // 2. Usage Stats (Last 30 days)
  const { data: usageLogs } = await supabase
    .from('usage_logs')
    .select('action')
    .eq('user_id', userId)
    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  const usageStats = usageLogs?.reduce((acc: Record<string, number>, log: any) => {
    acc[log.action] = (acc[log.action] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  // 3. Provider-specific Invoice logic
  let invoices: any[] = [];
  
  if (provider.type === 'stripe' && userData.stripe_customer_id) {
    const stripeInvoices = await stripe.invoices.list({ customer: userData.stripe_customer_id, limit: 5 });
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

  const tier = (userData.tier || 'free') as 'free' | 'pro';
  const tierConfig = STRIPE_PRICING[tier as keyof typeof STRIPE_PRICING] || STRIPE_PRICING.free;

  return {
    tier,
    analysesUsed: userData.analyses_used || 0,
    analysesLimit: tierConfig.analysesPerMonth,
    usageStats,
    invoices
  };
}
