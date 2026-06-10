export const dynamic = 'force-dynamic';

import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { PricingTableClient } from '@/components/billing/pricing-table-client';
import { Icon } from '@/components/templates/_shared/primitives';
import { FaqAccordion } from '@/components/marketing/FaqAccordion';
import { PricingComparisonTable } from '@/components/marketing/PricingComparisonTable';
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
          <Link href="/privacy-policy" style={{ color: "var(--ink-secondary)", textDecoration: "none", fontSize: 14 }}>Privacy</Link>
          <Link href="/terms-and-conditions" style={{ color: "var(--ink-secondary)", textDecoration: "none", fontSize: 14 }}>Terms</Link>
          <Link href="/refund-policy" style={{ color: "var(--ink-secondary)", textDecoration: "none", fontSize: 14 }}>Refunds</Link>
          <Link href="/pricing" style={{ color: "var(--accent)", textDecoration: "none", fontSize: 14, fontWeight: 500 }}>Pricing</Link>
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

        <section id="compare" style={{ padding: "80px 32px", maxWidth: 1280, margin: "0 auto", width: "100%", borderTop: "1px solid var(--line)" }}>
          <div style={{ maxWidth: "52ch", marginBottom: 48 }}>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-muted)", margin: 0 }}>{"// Deep Dive"}</p>
            <h2 className="hx-h2" style={{ marginTop: 12 }}>Compare all features</h2>
            <p className="hx-body-lg">A technical breakdown of our intelligence tiers.</p>
          </div>
          
          <PricingComparisonTable />
        </section>

        <section style={{ padding: "80px 32px", maxWidth: 1280, margin: "0 auto", width: "100%", borderTop: "1px solid var(--line)" }}>
          <div style={{ maxWidth: "52ch", marginBottom: 48 }}>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-muted)", margin: 0 }}>{"// FAQ"}</p>
            <h2 className="hx-h2" style={{ marginTop: 12 }}>Frequently Asked Questions</h2>
            <p className="hx-body-lg">Everything you need to know about our intelligence engine.</p>
          </div>

          <FaqAccordion items={[
            { q: "How does the synthesis engine work?", a: "We process video transcripts through our UCIS (Unified Content Intelligence System) model, which extracts claims, frameworks, and tactics across the most important dimensions." },
            { q: "Can I change my plan anytime?", a: "Yes. Upgrade or downgrade immediately. Pro-rated adjustments are handled automatically by our global payment processors." },
            { q: "Do you handle long-form videos?", a: "Yes. Our Pro and Enterprise tiers can synthesize videos up to 12 hours in length with full accuracy and timestamp mapping." },
            { q: "Which languages are supported?", a: "We currently support 40+ languages. The synthesis engine automatically detects and translates content into your primary workspace language." },
            { q: "Do you offer refunds?", a: "To maintain our compute-heavy infrastructure, we operate on a strict no-refund basis. We encourage starting with the Free tier to evaluate performance." },
            { q: "Is my data secure?", a: "Absolutely. All synthesis data is encrypted and stored in your private knowledge graph. Transcripts are held in transient cache for up to 72hrs and automatically removed. We never use user data to train third-party models." }
          ]} />
        </section>
      </main>

      <Footer />
    </>
  );
}
