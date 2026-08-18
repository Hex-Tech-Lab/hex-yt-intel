export const dynamic = 'force-dynamic';

import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { ResponsiveHeader } from '@/components/organisms/ResponsiveHeader';
import { PricingTableClient } from '@/components/billing/pricing-table-client';
import { FaqAccordion } from '@/components/marketing/FaqAccordion';
import { PricingComparisonTable } from '@/components/marketing/PricingComparisonTable';
import { Footer } from '@/components/Footer';

async function getUser() {
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export default async function PricingPage() {
  const user = await getUser();
  const userInfo = user && user.email ? { userId: user.id, userEmail: user.email } : null;

  return (
    <>
      <ResponsiveHeader user={user} />

      <main style={{ flex: 1 }}>
        <section style={{ padding: "60px 32px", maxWidth: 1280, margin: "0 auto", width: "100%" }}>
          <div style={{ maxWidth: "52ch", marginBottom: 48 }}>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-muted)", margin: 0 }}>{"// Plans"}</p>
            <h2 className="hx-h2" style={{ marginTop: 12 }}>Simple, transparent pricing.</h2>
            <p className="hx-body-lg">Monthly quotas by tier. Cancel anytime.</p>
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
            { q: "Do you handle long-form videos?", a: "Yes. Our Pro and Max tiers can synthesize longer videos with full accuracy and timestamp mapping, up to each tier's quota." },
            { q: "Which languages are supported?", a: "We currently support 65+ languages, tested and confirmed for real transcription/analysis accuracy. The synthesis engine automatically detects and translates content into your primary workspace language." },
            { q: "Do you offer refunds?", a: "Yes — within 7 days of purchase, if you haven't used any analysis credits on that purchase, it's fully refundable. Once an analysis has run, that credit is considered used." },
            { q: "Is my data secure?", a: "Absolutely. All synthesis data is encrypted and stored in your private knowledge graph. Transcripts are held in transient cache for up to 72hrs and automatically removed. We never use user data to train third-party models." }
          ]} />
        </section>
      </main>

      <Footer />
    </>
  );
}
