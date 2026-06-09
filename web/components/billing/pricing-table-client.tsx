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
      desc: "Get started", 
      features: ["3 syntheses/month", "Personal library only", "Standard support"],
      isPro: false
    },
    { 
      name: "Pro", 
      price: "$9", 
      desc: "/month, billed monthly", 
      features: ["Unlimited syntheses", "Durable persistence", "Semantic Search", "Export & Download", "API access"],
      isPro: true
    }
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24 }}>
      {plans.map((p) => (
        <div key={p.name} style={{ padding: 32, border: p.isPro ? "1px solid var(--accent)" : "1px solid var(--line)", borderRadius: 16, background: "rgb(26 31 43 / 0.6)" }}>
          <h3 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "var(--ink)" }}>{p.name}</h3>
          <p style={{ margin: "4px 0 0", fontSize: 32, fontWeight: 500, color: "var(--accent)" }}>{p.price}</p>
          <p style={{ margin: "2px 0 20px", fontSize: 13, color: "var(--ink-secondary)" }}>{p.desc}</p>
          
          {p.name === "Free" ? (
            <button className="btn-secondary" disabled style={{ width: "100%", opacity: 0.5, cursor: "not-allowed", border: "1px solid var(--line-strong)", background: "transparent", color: "var(--ink-secondary)", padding: "10px 17px", borderRadius: 8, fontSize: 14, fontFamily: "var(--font-sans)", fontWeight: 500 }}>
              Current Plan
            </button>
          ) : userInfo ? (
            <div style={{ width: "100%" }}>
              <CheckoutButton
                isLoading={isCheckoutLoading}
                setIsLoading={setIsCheckoutLoading}
              />
            </div>
          ) : (
            <button onClick={() => window.location.href = '/auth/signin'} className="btn-primary" style={{ width: "100%", background: "var(--accent-strong)", color: "var(--void)", border: "none", padding: "11px 18px", borderRadius: 8, fontSize: 14, fontFamily: "var(--font-sans)", fontWeight: 500, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              Get started
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
