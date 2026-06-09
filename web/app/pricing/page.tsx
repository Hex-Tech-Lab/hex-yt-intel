export const dynamic = 'force-dynamic';

import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { PricingTableClient } from '@/components/billing/pricing-table-client';
import { Icon } from '@/components/templates/_shared/primitives';
import Link from 'next/link';
import { Footer } from '@/components/Footer';

async function getUserInfo() {
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) return null;

  return { userId: user.id, userEmail: user.email };
}

export default async function PricingPage() {
  const userInfo = await getUserInfo();

  return (
    <>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 32px", borderBottom: "1px solid var(--line)", background: "rgb(17 20 29 / 0.7)", backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 20 }}>
        <Link href="/?v=landing" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
          <span style={{ display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: 8, background: "var(--accent-strong)", color: "var(--void)" }}>
            <Icon icon="solar:graph-up-linear" size={17} />
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600, letterSpacing: "0.04em", color: "var(--ink)" }}>HEX·YT·INTEL</span>
        </Link>
        <nav style={{ display: "flex", gap: 24, alignItems: "center" }}>
          <Link href="/pricing" style={{ color: "var(--accent)", textDecoration: "none", fontSize: 14, fontWeight: 500 }}>Pricing</Link>
          <Link href="/terms-and-conditions" style={{ color: "var(--ink-secondary)", textDecoration: "none", fontSize: 14 }}>Terms</Link>
          <Link href="/privacy-policy" style={{ color: "var(--ink-secondary)", textDecoration: "none", fontSize: 14 }}>Privacy</Link>
          {!userInfo && (
            <Link href="/auth/signin" className="btn-primary" style={{ textDecoration: "none" }}>Sign in</Link>
          )}
          {userInfo && (
            <Link href="/dashboard" className="btn-primary" style={{ textDecoration: "none" }}>Dashboard</Link>
          )}
        </nav>
      </header>

      <main style={{ flex: 1 }}>
        <section style={{ padding: "60px 32px", maxWidth: 1280, margin: "0 auto", width: "100%" }}>
          <div style={{ maxWidth: "52ch", marginBottom: 48 }}>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-muted)", margin: 0 }}>// Plans</p>
            <h2 className="hx-h2" style={{ marginTop: 12 }}>Simple, transparent pricing.</h2>
            <p className="hx-body-lg">Pay for what you use. Cancel anytime.</p>
          </div>
          
          <PricingTableClient userInfo={userInfo} />
        </section>

        <section style={{ padding: "60px 32px", maxWidth: 1280, margin: "0 auto", width: "100%", borderTop: "1px solid var(--line)" }}>
          <div style={{ maxWidth: "52ch", marginBottom: 48 }}>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-muted)", margin: 0 }}>// FAQ</p>
            <h2 className="hx-h2" style={{ marginTop: 12 }}>Frequently Asked Questions</h2>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 32 }}>
            {[
              { q: "Can I change my plan anytime?", a: "Yes. Upgrade to Pro or downgrade to Free immediately. Pro-rated adjustments are handled via Stripe." },
              { q: "Do you offer refunds?", a: "Due to immediate LLM infrastructure costs, we operate on a strict no-refund basis. Evaluation is available via the Free tier." },
              { q: "What payment methods do you accept?", a: "All major credit cards (Visa, Mastercard, Amex) processed securely via Stripe." },
              { q: "Is there a discount for annual billing?", a: "Annual plans with a 20% discount are scheduled for release in Q3 2026." }
            ].map((faq, i) => (
              <div key={i}>
                <h3 style={{ margin: "0 0 8px 0", fontSize: 16, fontWeight: 600, color: "var(--ink)" }}>{faq.q}</h3>
                <p style={{ margin: 0, fontSize: 14, color: "var(--ink-secondary)", lineHeight: 1.6 }}>{faq.a}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
