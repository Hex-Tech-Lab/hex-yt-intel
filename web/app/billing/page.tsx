import { redirect } from 'next/navigation';
import { stripe, STRIPE_PRICING } from '@/lib/stripe';
import { getSupabaseClientWithAuth, getSupabaseServiceClient } from '@/lib/supabase';
import { BillingDashboardClient } from '@/components/billing/billing-dashboard-client';

async function getBillingData(userId: string) {
  // Use service role for internal billing lookups to bypass RLS if needed,
  // or use the auth client if RLS is correctly configured for the user.
  // Here we use service role because we might need to check Stripe IDs.
  const supabase = getSupabaseServiceClient();

  // Get user data
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (userError || !userData) {
    throw new Error('Failed to fetch user data');
  }

  // Get usage stats
  const { data: usageLogs } = await supabase
    .from('usage_logs')
    .select('action, created_at')
    .eq('user_id', userId)
    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  const usageStats = usageLogs?.reduce((acc: Record<string, number>, log: any) => {
    acc[log.action] = (acc[log.action] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  // Get invoices from Stripe
  let invoices: any[] = [];
  if (userData.stripe_customer_id) {
    try {
      const stripeInvoices = await stripe.invoices.list({
        customer: userData.stripe_customer_id,
        limit: 10,
      });
      invoices = stripeInvoices.data.map((inv) => {
        const paidAtTimestamp = inv.status === 'paid' ? inv.created : null;
        return {
          id: inv.id,
          amount: inv.amount_paid,
          currency: inv.currency,
          status: inv.status,
          paidAt: paidAtTimestamp ? new Date(paidAtTimestamp * 1000) : null,
          dueDate: inv.due_date ? new Date(inv.due_date * 1000) : null,
          invoiceUrl: inv.hosted_invoice_url || '',
        };
      });
    } catch (error) {
      console.error('Failed to fetch invoices:', error);
    }
  }

  const tier = userData.tier as 'free' | 'pro' | 'enterprise';
  const tierConfig = STRIPE_PRICING[tier as keyof typeof STRIPE_PRICING] || STRIPE_PRICING.free;

  return {
    user: userData,
    tier,
    analysesUsed: userData.analyses_used || 0,
    analysesLimit: tierConfig.analysesPerMonth,
    usageStats,
    invoices,
  };
}

export default async function BillingPage() {
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/signin');
  }

  try {
    const billingData = await getBillingData(user.id);

    return (
      <div className="min-h-screen bg-slate-50">
        <BillingDashboardClient initialData={billingData} />
      </div>
    );
  } catch (error) {
    console.error('[/billing] Error:', error);
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow p-6 max-w-md">
          <h1 className="text-xl font-bold text-red-600 mb-2">Error Loading Billing</h1>
          <p className="text-gray-700">Failed to load billing information. Please try again.</p>
        </div>
      </div>
    );
  }
}
