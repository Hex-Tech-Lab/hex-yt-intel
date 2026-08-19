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
      <div className="grid max-w-[900px] grid-cols-[repeat(auto-fit,minmax(300px,1fr))] items-stretch gap-6">
        {FOUNDER_PLANS.map((plan, i) => (
          <motion.div
            key={plan.name}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -4, background: "var(--accent-a06)" }}
            transition={{ duration: 0.45, delay: i * 0.06, ease: "easeOut" }}
            className={`relative flex h-full flex-col rounded-2xl bg-[rgb(26_31_43_/_0.6)] p-8 ${plan.recommended ? "border border-[var(--accent)]" : "border border-[var(--line)]"}`}
          >
            {plan.recommended && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-[20px] bg-[var(--accent)] px-3 py-1 font-mono text-[10px] font-bold tracking-[0.1em] text-[var(--void)]">LONGEST LOCK</div>
            )}
            <h3 className="m-0 text-xl font-semibold text-[var(--ink)]">{plan.name}</h3>

            <div className="mt-1 flex flex-wrap items-baseline gap-2">
              <p className="m-0 text-[32px] font-medium text-[var(--accent)]">${plan.price}*</p>
              <span className="text-[13px] text-[var(--ink-muted)]">one-time payment, not a subscription</span>
            </div>
            <p className="mb-0 mt-1.5 text-xs font-semibold text-[var(--ok)]">{plan.lockLabel}</p>
            <p className="mb-5 mt-0.5 text-[13px] text-[var(--ink-secondary)]">{plan.desc}</p>

            <ul className="m-0 mb-5 flex-1 list-none p-0">
              {plan.included.map((feature) => (
                <li key={feature.label} className="mb-2.5 flex items-center gap-2 text-[13px] text-[var(--ink-secondary)]">
                  <Icon icon="solar:check-circle-linear" size={16} className="shrink-0 text-[var(--ok)]" />
                  <Tooltip content={feature.tooltip}>
                    <span>{feature.label}</span>
                  </Tooltip>
                </li>
              ))}
              {plan.notIncluded.map((feature) => (
                <li key={feature.label} className="mb-2.5 flex items-center gap-2 text-[13px] text-[var(--ink-muted)] opacity-70">
                  <Icon icon="solar:close-circle-linear" size={16} className="shrink-0 text-[var(--ink-muted)]" />
                  <Tooltip content={feature.tooltip}>
                    <span>{feature.label}</span>
                  </Tooltip>
                </li>
              ))}
            </ul>

            <div className="mt-auto">
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

      <p className="mt-4 text-[11px] text-[var(--ink-muted)]">
        * Candidate numbers, not final — illustrative starting points still under review, not a live offer yet.
        This is a single one-time payment, not a recurring subscription or renewal. The &quot;~1yr/~2yr&quot; figures
        describe how long the founding-member discount stays honored after that one-time payment — not a
        billing interval. Exact discount-lock durations, exact bounded quota sizes, and checkout are not yet
        built. First cohort target is roughly 200 founding members; oversubscription is welcomed, not capped.
      </p>
    </div>
  );
}
