export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { stripe, STRIPE_PRICING } from '@/lib/stripe';
import { getSupabaseClientWithAuth, getSupabaseServiceClient } from '@/lib/supabase';
import { BillingDashboardClient } from '@/components/billing/billing-dashboard-client';
import { Icon } from '@/components/templates/_shared/primitives';
import Link from 'next/link';
import { Footer } from '@/components/Footer';

async function getBillingData(userId: string) {
  const supabase = getSupabaseServiceClient();

  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (userError || !userData) {
    throw new Error('Failed to fetch user data');
  }

  const { data: usageLogs } = await supabase
    .from('usage_logs')
    .select('action, created_at')
    .eq('user_id', userId)
    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  const usageStats = usageLogs?.reduce((acc: Record<string, number>, log: any) => {
    acc[log.action] = (acc[log.action] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

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
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "var(--void)", color: "var(--ink)", fontFamily: "var(--font-sans)" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 32px", borderBottom: "1px solid var(--line)", background: "rgb(17 20 29 / 0.7)", backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 20 }}>
          <Link href="/?v=landing" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
            <span style={{ display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: 8, background: "var(--accent-strong)", color: "var(--void)" }}>
              <Icon icon="solar:graph-up-linear" size={17} />
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600, letterSpacing: "0.04em", color: "var(--ink)" }}>HEX·YT·INTEL</span>
          </Link>
          <nav style={{ display: "flex", gap: 24, alignItems: "center" }}>
            <Link href="/dashboard" style={{ color: "var(--ink-secondary)", textDecoration: "none", fontSize: 14 }}>Dashboard</Link>
            <Link href="/pricing" style={{ color: "var(--ink-secondary)", textDecoration: "none", fontSize: 14 }}>Pricing</Link>
          </nav>
        </header>

        <main style={{ flex: 1, padding: "60px 32px", maxWidth: 1280, margin: "0 auto", width: "100%" }}>
          <div style={{ marginBottom: 48 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
              <Link href="/dashboard" style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-muted)", textDecoration: "none" }}>Dashboard</Link>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-muted)" }}>/</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--accent)" }}>Billing</span>
            </div>
            
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-muted)", margin: "0 0 12px 0" }}>// Account Administration</p>
            <h1 className="hx-display" style={{ margin: 0, fontSize: 32 }}>
              Billing & Account
            </h1>
          </div>

          <div style={{ maxWidth: 800 }}>
            <BillingDashboardClient initialData={billingData} />
          </div>
        </main>
        
        <Footer />
      </div>
    );
  } catch (error) {
    console.error('[/billing] Error:', error);
    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "var(--void)", color: "var(--ink)", fontFamily: "var(--font-sans)", alignItems: "center", justifyContent: "center" }}>
        <div style={{ padding: 24, borderRadius: 12, border: "1px solid var(--err)", background: "var(--surface)" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "var(--err)", margin: "0 0 8px 0" }}>Error Loading Billing</h1>
          <p style={{ color: "var(--ink-secondary)", margin: 0, fontSize: 14 }}>Failed to load billing information. Please try again.</p>
        </div>
      </div>
    );
  }
}
