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
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-muted)", margin: 0 }}>{"// Plans"}</p>
            <h2 className="hx-h2" style={{ marginTop: 12 }}>Simple, transparent pricing.</h2>
            <p className="hx-body-lg">Pay for what you use. Cancel anytime.</p>
          </div>
          
          <PricingTableClient userInfo={userInfo} />
        </section>

        <section style={{ padding: "80px 32px", maxWidth: 1280, margin: "0 auto", width: "100%", borderTop: "1px solid var(--line)" }}>
          <div style={{ maxWidth: "52ch", marginBottom: 48 }}>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-muted)", margin: 0 }}>{"// FAQ"}</p>
            <h2 className="hx-h2" style={{ marginTop: 12 }}>Frequently Asked Questions</h2>
            <p className="hx-body-lg">Everything you need to know about our intelligence engine.</p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 800 }}>
            {[
              { q: "How does the synthesis engine work?", a: "We process video transcripts through our UCIS (Unified Content Intelligence System) model, which extracts claims, frameworks, and tactics across 11 semantic dimensions." },
              { q: "Can I change my plan anytime?", a: "Yes. Upgrade or downgrade immediately. Pro-rated adjustments are handled automatically by our global payment processors." },
              { q: "Do you handle long-form videos?", a: "Yes. Our Pro and Enterprise tiers can synthesize videos up to 12 hours in length with full accuracy and timestamp mapping." },
              { q: "Which languages are supported?", a: "We currently support 40+ languages. The synthesis engine automatically detects and translates content into your primary workspace language." },
              { q: "Do you offer refunds?", a: "To maintain our compute-heavy infrastructure, we operate on a strict no-refund basis. We encourage starting with the Free tier to evaluate performance." },
              { q: "Is my data secure?", a: "Absolutely. All synthesis data is encrypted and stored in your private knowledge graph. We never use user data to train third-party models." }
            ].map((faq, i) => (
              <details key={i} style={{ 
                background: "var(--surface)", 
                border: "1px solid var(--line)", 
                borderRadius: 12, 
                padding: "16px 20px",
                cursor: "pointer"
              }}>
                <summary style={{ 
                  listStyle: "none", 
                  fontSize: 15, 
                  fontWeight: 600, 
                  color: "var(--ink)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}>
                  {faq.q}
                  <Icon icon="solar:alt-arrow-down-linear" size={16} style={{ color: "var(--ink-muted)" }} />
                </summary>
                <p style={{ 
                  marginTop: 12, 
                  fontSize: 14, 
                  color: "var(--ink-secondary)", 
                  lineHeight: 1.6,
                  borderTop: "1px solid var(--line)",
                  paddingTop: 12
                }}>
                  {faq.a}
                </p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
