export const dynamic = 'force-dynamic';

import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { ResponsiveHeader } from '@/components/organisms/ResponsiveHeader';
import { Footer } from '@/components/Footer';
import { FoundersTableClient } from '@/components/billing/founders-table-client';

async function getUser() {
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// DRAFT / PREP PAGE — same status as web/app/pricing/page.tsx: real structure built
// now with CANDIDATE numbers so it can be updated fast once the LLM Council's
// founder-tier numbers lock. Source: docs/private/2026-08-16_PRICING_ECONOMICS_MASTER_MODEL.md
// §6/§6a/§6f/§6q, cross-checked against docs/private/council/2026-08-17_pricing_wave1_council-transcript.md.
// Do NOT wire real checkout/billing here until numbers are final.
export default async function FoundersPage() {
  const user = await getUser();

  return (
    <>
      <ResponsiveHeader user={user} />

      <main style={{ flex: 1 }}>
        <section style={{ padding: "60px 32px 40px", maxWidth: 1280, margin: "0 auto", width: "100%" }}>
          <div style={{ maxWidth: "62ch" }}>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-muted)", margin: 0 }}>{"// Founder pre-sale"}</p>
            <h1 className="hx-h2" style={{ marginTop: 12 }}>We&apos;re a bootstrapped, solo-founder build. This funds the runway to keep building it.</h1>
            <p className="hx-body-lg" style={{ marginTop: 12 }}>
              There&apos;s no VC round behind this. The founder pre-sale is the honest, primary way we fund
              infrastructure and development through launch — not a discount gesture, a real trade: you get
              full access locked in early, we get the runway to ship. Open to a bounded first cohort, not
              an evergreen offer.
            </p>
            <p style={{ marginTop: 16, fontSize: 12, color: "var(--ink-muted)", fontFamily: "var(--font-mono)" }}>
              {'// Candidate numbers below — not final. Locks once the pricing council finishes review.'}
            </p>
          </div>
        </section>

        <section style={{ padding: "20px 32px 40px", maxWidth: 1280, margin: "0 auto", width: "100%" }}>
          <FoundersTableClient />
        </section>

        <section style={{ padding: "60px 32px 80px", maxWidth: 1280, margin: "0 auto", width: "100%", borderTop: "1px solid var(--line)" }}>
          <div style={{ maxWidth: "60ch" }}>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-muted)", margin: 0 }}>{"// The honest version"}</p>
            <h2 className="hx-h2" style={{ marginTop: 12 }}>Why this exists, plainly</h2>
            <ul style={{ marginTop: 16, paddingLeft: 20, color: "var(--ink-secondary)", fontSize: 15, lineHeight: 1.7 }}>
              <li>We&apos;re targeting a first cohort of roughly 200 founding members. If we&apos;re oversubscribed, we welcome it rather than cap it artificially — more signups at the same bounded economics is just more runway, not a problem.</li>
              <li>Both founder tiers unlock everything, feature-wise, from day one. The difference between Light and Pro is how long your discounted price stays locked, not what you can do.</li>
              <li>Quota is generous but bounded — not unlimited, not lifetime. Unlimited-forever access sunk other companies that priced this exact deal wrong; we&apos;d rather be upfront about a real (generous) cap than make a promise we can&apos;t keep two years in.</li>
              <li>During the founding period, every paid tier runs the same full-depth analysis under the hood — we&apos;re not gating quality by price point while this offer is live.</li>
            </ul>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
