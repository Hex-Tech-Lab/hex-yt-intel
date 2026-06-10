'use client';

import { useState } from 'react';
import { CheckoutButton } from './checkout-button';
import { Icon } from '@/components/templates/_shared/primitives';

interface PricingTableClientProps {
  userInfo: {
    userId: string;
    userEmail: string;
  } | null;
}

export function PricingTableClient({ userInfo }: PricingTableClientProps) {
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);

  const plans = [
    { 
      name: "Free", 
      price: "$0", 
      desc: "Individual experimenters", 
      features: ["3 syntheses/month", "Personal library only", "Standard support"],
      isPro: false,
      isEnterprise: false
    },
    { 
      name: "Pro", 
      price: "$9", 
      desc: "Serious content analysts", 
      features: ["Unlimited syntheses", "Durable persistence", "Semantic Search", "Export & Download", "API access"],
      isPro: true,
      isEnterprise: false
    },
    { 
      name: "Enterprise", 
      price: "$99", 
      desc: "For high-volume operations", 
      features: ["1000 syntheses/mo", "Dedicated infrastructure", "Priority SLA", "SSO & SAML Auth", "White-glove setup"],
      isPro: false,
      isEnterprise: true
    }
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24 }}>
      {plans.map((p) => (
        <div key={p.name} style={{ 
          padding: 32, 
          border: p.isPro || p.isEnterprise ? "1px solid var(--accent)" : "1px solid var(--line)", 
          borderRadius: 16, 
          background: "rgb(26 31 43 / 0.6)",
          position: "relative",
          display: "flex",
          flexDirection: "column"
        }}>
          {p.isEnterprise && (
            <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: "var(--accent)", color: "var(--void)", padding: "4px 12px", borderRadius: 20, fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: "0.1em" }}>MAX SCALE</div>
          )}
          <h3 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "var(--ink)" }}>{p.name}</h3>
          <p style={{ margin: "4px 0 0", fontSize: 32, fontWeight: 500, color: "var(--accent)" }}>{p.price}</p>
          <p style={{ margin: "2px 0 20px", fontSize: 13, color: "var(--ink-secondary)" }}>{p.desc}</p>
          
          {p.name === "Free" ? (
            <button className="btn-secondary" disabled style={{ width: "100%", opacity: 0.5, cursor: "not-allowed", border: "1px solid var(--line-strong)", background: "transparent", color: "var(--ink-secondary)", padding: "10px 17px", borderRadius: 8, fontSize: 14, fontFamily: "var(--font-sans)", fontWeight: 500 }}>
              Current Plan
            </button>
          ) : (p.isPro && userInfo) ? (
            <div style={{ width: "100%" }}>
              <CheckoutButton
                isLoading={isCheckoutLoading}
                setIsLoading={setIsCheckoutLoading}
              />
            </div>
          ) : (
            <button onClick={() => window.location.href = p.isEnterprise ? 'mailto:sales@v-intel.app' : '/auth/signin'} className="btn-primary" style={{ width: "100%", background: p.isEnterprise ? "var(--ink)" : "var(--accent-strong)", color: "var(--void)", border: "none", padding: "11px 18px", borderRadius: 8, fontSize: 14, fontFamily: "var(--font-sans)", fontWeight: 500, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              {p.isEnterprise ? 'Contact Sales' : 'Get started'}
            </button>
          )}

          <ul style={{ marginTop: 20, listStyle: "none", padding: 0 }}>
            {p.features.map((f) => (
              <li key={f} style={{ fontSize: 13, color: "var(--ink-secondary)", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                <Icon icon="solar:check-circle-linear" size={16} style={{ color: "var(--ok)" }} />
                {f}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
