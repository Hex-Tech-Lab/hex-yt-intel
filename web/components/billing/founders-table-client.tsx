'use client';

import { motion } from 'framer-motion';
import { Button } from '@astryxdesign/core/Button';
import { Tooltip } from '@astryxdesign/core';
import { Icon } from '@/components/templates/_shared/primitives';

interface FounderPlan {
  name: string;
  price: number;
  lockLabel: string;
  desc: string;
  included: { label: string; tooltip: string }[];
  notIncluded: { label: string; tooltip: string }[];
  recommended: boolean;
}

// DRAFT / PLACEHOLDER — real numbers sourced from
// docs/private/2026-08-16_PRICING_ECONOMICS_MASTER_MODEL.md §6/§6q (Founder Light $49,
// Founder Pro $99, "illustrative, ~3-3.5x Light's value, real research-backed number
// still needed"). Discount-lock durations (1yr / 2yr) are TBD per the same doc.
// Do not ship to production until the pricing council's numbers lock.
const FOUNDER_PLANS: FounderPlan[] = [
  {
    name: "Founder Light",
    price: 49,
    lockLabel: "One-time payment -- discount honored ~1 year (candidate)",
    desc: "Full access, first-cohort pricing, shorter lock",
    included: [
      { label: "Full UCIS access unlocked", tooltip: "Every feature-gated capability, not a scoped-down starter set." },
      { label: "Generous, bounded monthly quota", tooltip: "Sized well above the eventual standard Pro tier — not unlimited or lifetime, a real bounded cap." },
      { label: "Founding-member price locked for the discount period", tooltip: "Your price stays at this rate for the locked duration, not just at signup." },
      { label: "Full Knowledge Graph + Executive Digest", tooltip: "The same visual and summary tooling as every other tier." },
    ],
    notIncluded: [
      { label: "The longer discount-lock duration reserved for Founder Pro", tooltip: "Founder Pro keeps its founding price for a longer period — the real upsell lever between the two tiers." },
    ],
    recommended: false,
  },
  {
    name: "Founder Pro",
    price: 99,
    lockLabel: "One-time payment -- discount honored ~2 years (candidate)",
    desc: "Everything in Light, longer price-lock, first pick on quota",
    included: [
      { label: "Everything in Founder Light", tooltip: "Full UCIS access, full Knowledge Graph, Executive Digest — no scope reduction." },
      { label: "Founding-member price locked for the extended period", tooltip: "The real differentiator vs. Founder Light — you keep this rate significantly longer." },
      { label: "Priority on any founder-cohort quota increases", tooltip: "If bounded quotas move, Founder Pro is first in line — exact mechanism still being defined." },
    ],
    notIncluded: [],
    recommended: true,
  },
];

export function FoundersTableClient() {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24, alignItems: "stretch", maxWidth: 900 }}>
        {FOUNDER_PLANS.map((p, i) => (
          <motion.div
            key={p.name}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -4, background: "var(--accent-a06)" }}
            transition={{ duration: 0.45, delay: i * 0.06, ease: "easeOut" }}
            style={{
              padding: 32,
              border: p.recommended ? "1px solid var(--accent)" : "1px solid var(--line)",
              borderRadius: 16,
              background: "rgb(26 31 43 / 0.6)",
              position: "relative",
              display: "flex",
              flexDirection: "column",
              height: "100%",
            }}
          >
            {p.recommended && (
              <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: "var(--accent)", color: "var(--void)", padding: "4px 12px", borderRadius: 20, fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: "0.1em" }}>LONGEST LOCK</div>
            )}
            <h3 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "var(--ink)" }}>{p.name}</h3>

            <div style={{ marginTop: 4, display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <p style={{ margin: 0, fontSize: 32, fontWeight: 500, color: "var(--accent)" }}>${p.price}*</p>
              <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>one-time payment, not a subscription</span>
            </div>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--ok)", fontWeight: 600 }}>{p.lockLabel}</p>
            <p style={{ margin: "2px 0 20px", fontSize: 13, color: "var(--ink-secondary)" }}>{p.desc}</p>

            <ul style={{ margin: 0, marginBottom: 20, listStyle: "none", padding: 0, flex: 1 }}>
              {p.included.map((f) => (
                <li key={f.label} style={{ fontSize: 13, color: "var(--ink-secondary)", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                  <Icon icon="solar:check-circle-linear" size={16} style={{ color: "var(--ok)", flexShrink: 0 }} />
                  <Tooltip content={f.tooltip}>
                    <span>{f.label}</span>
                  </Tooltip>
                </li>
              ))}
              {p.notIncluded.map((f) => (
                <li key={f.label} style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 10, display: "flex", alignItems: "center", gap: 8, opacity: 0.7 }}>
                  <Icon icon="solar:close-circle-linear" size={16} style={{ color: "var(--ink-muted)", flexShrink: 0 }} />
                  <Tooltip content={f.tooltip}>
                    <span>{f.label}</span>
                  </Tooltip>
                </li>
              ))}
            </ul>

            <div style={{ marginTop: "auto" }}>
              <Button
                label="Join the founder waitlist"
                variant="primary"
                size="md"
                width="100%"
                onClick={() => { window.location.href = '/waitlist'; }}
              />
            </div>
          </motion.div>
        ))}
      </div>

      <p style={{ marginTop: 16, fontSize: 11, color: "var(--ink-muted)" }}>
        * Candidate numbers, not final — illustrative starting points still under review, not a live offer yet.
        This is a single one-time payment, not a recurring subscription or renewal. The &quot;~1yr/~2yr&quot; figures
        describe how long the founding-member discount stays honored after that one-time payment — not a
        billing interval. Exact discount-lock durations, exact bounded quota sizes, and checkout are not yet
        built. First cohort target is roughly 200 founding members; oversubscription is welcomed, not capped.
      </p>
    </div>
  );
}
