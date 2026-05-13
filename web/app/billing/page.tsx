import { getServerSession } from 'next-auth';
import { authConfig } from '@/lib/auth/nextauth-config';
import { createClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { stripe, STRIPE_PRICING } from '@/lib/stripe';
import { BillingDashboardClient } from '@/components/billing/billing-dashboard-client';

async function getBillingData(userId: string) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );

  // Get user data
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (userError || !userData) {
    throw new Error('Failed to fetch user data');
  }

  // Get usage stats
  const { data: usageLogs } = await supabase
    .from('usage_logs')
    .select('action, created_at')
    .eq('user_id', userId)
    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  const usageStats = usageLogs?.reduce((acc, log) => {
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
        // Stripe Invoice uses created timestamp, not paid_date
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
  const session = await getServerSession(authConfig);

  if (!session?.user) {
    redirect('/auth/signin');
  }

  const userId = (session.user as any).id;

  try {
    const billingData = await getBillingData(userId);

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
