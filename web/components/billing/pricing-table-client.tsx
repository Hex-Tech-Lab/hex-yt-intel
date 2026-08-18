'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@astryxdesign/core/Button';
import { Switch, Tooltip } from '@astryxdesign/core';
import { CheckoutButton } from './checkout-button';
import { Icon } from '@/components/templates/_shared/primitives';
import { PRICING_APPROVED, PRICING_PLANS, type PricingPlan } from '@/lib/constants/pricing-plans';

interface PricingTableClientProps {
  userInfo: {
    userId: string;
    userEmail: string;
  } | null;
}

// Standard SaaS convention: 2 months free on annual billing (~17% off).
// No locked yearly-discount figure exists yet in
// docs/private/2026-08-16_PRICING_ECONOMICS_MASTER_MODEL.md (that doc only
// covers founder-tier discount *duration*, not a standard monthly/yearly
// toggle) — using the common default until a real figure is decided.
const YEARLY_DISCOUNT_MONTHS = 2;

function formatPrice(plan: PricingPlan, yearly: boolean): { price: string; strike?: string; savings?: string } {
  if (plan.monthlyPrice === null) return { price: "Contact us*" };
  if (plan.monthlyPrice === 0) return { price: "$0" };

  if (!yearly) return { price: `$${plan.monthlyPrice}/mo*` };

  const yearlyMonthlyEquivalent = plan.monthlyPrice * (12 - YEARLY_DISCOUNT_MONTHS) / 12;
  const savings = plan.monthlyPrice * YEARLY_DISCOUNT_MONTHS;
  return {
    price: `$${yearlyMonthlyEquivalent.toFixed(2)}/mo*`,
    strike: `$${plan.monthlyPrice}/mo`,
    savings: `Save $${savings}/yr`,
  };
}

export function PricingTableClient({ userInfo }: PricingTableClientProps) {
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [isYearly, setIsYearly] = useState(false);

  const plans = useMemo(() => PRICING_PLANS.map((p) => ({ ...p, ...formatPrice(p, isYearly) })), [isYearly]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
        <Switch
          label="Bill yearly"
          description={`Save ~17% (${YEARLY_DISCOUNT_MONTHS} months free)`}
          value={isYearly}
          onChange={setIsYearly}
          labelPosition="end"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 24, alignItems: "stretch" }}>
        {plans.map((p, i) => (
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
              <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: "var(--accent)", color: "var(--void)", padding: "4px 12px", borderRadius: 20, fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: "0.1em" }}>RECOMMENDED</div>
            )}
            <h3 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "var(--ink)" }}>{p.name}</h3>

            <div style={{ marginTop: 4, display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <p style={{ margin: 0, fontSize: 32, fontWeight: 500, color: "var(--accent)" }}>{p.price}</p>
              {p.strike && (
                <span style={{ fontSize: 14, color: "var(--ink-muted)", textDecoration: "line-through" }}>{p.strike}</span>
              )}
            </div>
            {p.savings && (
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ok)", fontWeight: 600 }}>{p.savings}</p>
            )}
            <p style={{ margin: "2px 0 20px", fontSize: 13, color: "var(--ink-secondary)" }}>{p.desc}</p>

            {/* Fixed-position feature list above the CTA, pinned to the card bottom via mt-auto,
                so all 4 cards' buttons line up regardless of differing content length. */}
            <ul style={{ margin: 0, marginBottom: 20, listStyle: "none", padding: 0, flex: 1 }}>
              {p.features.map((f) => (
                <li key={f.label} style={{ fontSize: 13, color: "var(--ink-secondary)", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                  <Icon icon="solar:check-circle-linear" size={16} style={{ color: "var(--ok)", flexShrink: 0 }} />
                  <Tooltip content={f.tooltip}>
                    <span>{f.label}</span>
                  </Tooltip>
                </li>
              ))}
            </ul>

            <div style={{ marginTop: "auto" }}>
              {p.name === "Free" ? (
                <Button label="Current Plan" variant="secondary" size="md" width="100%" isDisabled />
              ) : !PRICING_APPROVED ? (
                // Candidate/unapproved pricing (see PRICING_APPROVED doc
                // comment) -- render as a non-transactable preview instead
                // of a working checkout, so a candidate price can never be
                // bought for real before it's actually approved.
                <Tooltip content="This pricing is a candidate range under review, not final -- checkout opens once it's locked.">
                  <Button label="Coming soon" variant="secondary" size="md" width="100%" isDisabled />
                </Tooltip>
              ) : (p.recommended && userInfo) ? (
                <div style={{ width: "100%" }}>
                  <CheckoutButton
                    isLoading={isCheckoutLoading}
                    setIsLoading={setIsCheckoutLoading}
                    plan={p.checkoutPlan}
                    interval={isYearly ? 'year' : 'month'}
                  />
                </div>
              ) : (
                <Button
                  label={p.name === "Max" ? 'Contact Sales' : 'Get started'}
                  variant="primary"
                  size="md"
                  width="100%"
                  onClick={() => window.location.href = p.name === "Max" ? 'mailto:sales@v-intel.app' : '/auth/signin'}
                />
              )}
            </div>
          </motion.div>
        ))}
      </div>

      <p style={{ marginTop: 16, fontSize: 11, color: "var(--ink-muted)" }}>
        * Founding-period pricing shown at the low end of a candidate range and subject to change before launch.
      </p>
    </div>
  );
}
