'use client';

import { useState } from 'react';
import { STRIPE_PRICING } from '@/lib/stripe';
import { CheckoutButton } from './checkout-button';

interface BillingDashboardProps {
  initialData: {
    user: any;
    tier: 'free' | 'pro' | 'enterprise';
    analysesUsed: number;
    analysesLimit: number | null;
    usageStats: Record<string, number>;
    invoices: any[];
  };
}

export function BillingDashboardClient({ initialData }: BillingDashboardProps) {
  const [isLoading, setIsLoading] = useState(false);
  const tierConfig = STRIPE_PRICING[initialData.tier as keyof typeof STRIPE_PRICING] || STRIPE_PRICING.free;
  
  const isPro = initialData.tier === 'pro' || initialData.tier === 'enterprise';
  const statusColor = isPro ? "var(--ok)" : "var(--accent)";
  const status = isPro ? "active" : "free";
  
  const usagePercent =
    initialData.analysesLimit && initialData.analysesLimit > 0
      ? (initialData.analysesUsed / initialData.analysesLimit) * 100
      : 0;

  const isNearLimit = usagePercent >= 80 && usagePercent < 100;
  const isAtLimit = usagePercent >= 100;

  const handleManageBilling = async () => {
    try {
      const response = await fetch('/api/billing/portal', { method: 'POST' });
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Current Plan Card (from Design System SubscriptionOverview) */}
      <div
        style={{
          padding: 20,
          borderRadius: 12,
          border: "1px solid var(--line)",
          background: "var(--surface)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "var(--ink)" }}>
            Subscription
          </h2>
          <span style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              borderRadius: 9999,
              border: "1px solid var(--line)",
              background: "rgb(26 31 43 / 0.6)",
              padding: "4px 11px",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              color: statusColor,
              textTransform: "uppercase",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor }} />
            {status}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
          <div>
            <p style={{ margin: 0, fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.08em", color: "var(--ink-muted)", textTransform: "uppercase" }}>
              Current Plan
            </p>
            <p style={{ margin: "4px 0 0 0", fontSize: 16, fontWeight: 600, color: "var(--ink)" }}>
              {initialData.tier === 'free' ? 'Free Plan' : 'Pro Plan'}
            </p>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.08em", color: "var(--ink-muted)", textTransform: "uppercase" }}>
              Monthly Cost
            </p>
            <p style={{ margin: "4px 0 0 0", fontSize: 16, fontWeight: 600, color: "var(--ink)" }}>
              {tierConfig.price === 0 ? '$0' : `$${(tierConfig.price / 100).toFixed(2)}`}
            </p>
          </div>
        </div>

        {!isPro ? (
           <CheckoutButton isLoading={isLoading} setIsLoading={setIsLoading} />
        ) : (
          <button
            type="button"
            onClick={handleManageBilling}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "transparent",
              color: "var(--accent)",
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all var(--dur-fast)",
            }}
            onMouseOver={(e) => e.currentTarget.style.background = "rgb(6 182 212 / 0.10)"}
            onMouseOut={(e) => e.currentTarget.style.background = "transparent"}
          >
            Manage in Billing Portal
          </button>
        )}
      </div>

      {/* Usage Stats */}
      <div
        style={{
          padding: 20,
          borderRadius: 12,
          border: "1px solid var(--line)",
          background: "var(--surface)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "var(--ink)" }}>
            Usage & Quota
          </h2>
        </div>
        
        <p style={{ margin: 0, fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.08em", color: "var(--ink-muted)", textTransform: "uppercase" }}>
          Analyses This Month
        </p>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4, marginBottom: 12 }}>
          <span style={{ fontSize: 24, fontWeight: 700, color: "var(--accent)" }}>{initialData.analysesUsed}</span>
          <span style={{ fontSize: 14, color: "var(--ink-secondary)" }}>
            / {initialData.analysesLimit ? initialData.analysesLimit : 'Unlimited'}
          </span>
        </div>

        {initialData.analysesLimit && (
          <div>
             <div style={{ width: "100%", background: "var(--line)", height: 6, borderRadius: 9999, overflow: "hidden" }}>
                <div 
                  style={{ 
                    height: "100%", 
                    background: isAtLimit ? "var(--err)" : isNearLimit ? "var(--warn)" : "var(--accent)",
                    width: `${Math.min(usagePercent, 100)}%`,
                    transition: "width 500ms ease"
                  }} 
                />
             </div>
             <p style={{ marginTop: 8, fontSize: 12, color: isAtLimit ? "var(--err)" : isNearLimit ? "var(--warn)" : "var(--ink-secondary)" }}>
               {isAtLimit && '⚠️ Quota exceeded'}
               {isNearLimit && !isAtLimit && '⚠️ Nearing limit'}
               {!isAtLimit && !isNearLimit && `${100 - Math.round(usagePercent)}% remaining`}
             </p>
          </div>
        )}
      </div>

      {/* Promos & Rewards (10X Design Port) */}
      <div
        style={{
          padding: 20,
          borderRadius: 12,
          border: "1px solid var(--line)",
          background: "var(--surface)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "var(--ink)" }}>
            Promos & Rewards
          </h2>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
          <div style={{ padding: 16, borderRadius: 8, background: "rgb(26 31 43 / 0.4)", border: "1px dashed var(--line)" }}>
             <p style={{ margin: 0, fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--ink-muted)", textTransform: "uppercase" }}>Your Referral Link</p>
             <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <code style={{ fontSize: 12, color: "var(--accent)" }}>v-intel.app/r/user_{initialData.user.id.slice(0,5)}</code>
                <button onClick={() => navigator.clipboard.writeText(`https://v-intel.app/r/user_${initialData.user.id.slice(0,5)}`)} style={{ background: "transparent", border: "none", color: "var(--ink-secondary)", cursor: "pointer" }}>
                  <Icon icon="solar:copy-linear" size={14} />
                </button>
             </div>
          </div>
          <div style={{ padding: 16, borderRadius: 8, background: "rgb(26 31 43 / 0.4)", border: "1px dashed var(--line)" }}>
             <p style={{ margin: 0, fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--ink-muted)", textTransform: "uppercase" }}>Active Credits</p>
             <p style={{ margin: "4px 0 0 0", fontSize: 18, fontWeight: 600, color: "var(--ok)" }}>$0.00</p>
          </div>
        </div>

        <div style={{ borderRadius: 8, border: "1px solid var(--line)", overflow: "hidden" }}>
           <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
             <thead style={{ background: "var(--bg)", borderBottom: "1px solid var(--line)" }}>
               <tr>
                 <th style={{ padding: 10, textAlign: "left", color: "var(--ink-muted)" }}>CODE</th>
                 <th style={{ padding: 10, textAlign: "left", color: "var(--ink-muted)" }}>TYPE</th>
                 <th style={{ padding: 10, textAlign: "left", color: "var(--ink-muted)" }}>STATUS</th>
                 <th style={{ padding: 10, textAlign: "right", color: "var(--ink-muted)" }}>ACTION</th>
               </tr>
             </thead>
             <tbody>
               <tr style={{ borderBottom: "1px solid var(--line)" }}>
                 <td colSpan={4} style={{ padding: 20, textAlign: "center", color: "var(--ink-muted)", fontStyle: "italic" }}>
                   No active promo codes or gift cards found.
                 </td>
               </tr>
             </tbody>
           </table>
        </div>
      </div>

      {/* Invoice History (PromosTable design clone) */}
      {initialData.invoices && initialData.invoices.length > 0 && (
        <div
          style={{
            padding: 20,
            borderRadius: 12,
            border: "1px solid var(--line)",
            background: "var(--surface)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "var(--ink)" }}>
              Invoice History
            </h2>
          </div>

          <div style={{ borderRadius: 8, border: "1px solid var(--line)", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--line)" }}>
                  <th style={{ padding: 12, textAlign: "left", fontWeight: 600, color: "var(--ink-muted)", fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>Date</th>
                  <th style={{ padding: 12, textAlign: "left", fontWeight: 600, color: "var(--ink-muted)", fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>Amount</th>
                  <th style={{ padding: 12, textAlign: "left", fontWeight: 600, color: "var(--ink-muted)", fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>Status</th>
                  <th style={{ padding: 12, textAlign: "right", fontWeight: 600, color: "var(--ink-muted)", fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {initialData.invoices.map((inv) => (
                  <tr key={inv.id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: 12, color: "var(--ink)" }}>
                      {inv.paidAt ? inv.paidAt.toLocaleDateString() : 'Pending'}
                    </td>
                    <td style={{ padding: 12, color: "var(--ink)" }}>
                      ${(inv.amount / 100).toFixed(2)} {inv.currency.toUpperCase()}
                    </td>
                    <td style={{ padding: 12 }}>
                      <span style={{ 
                        color: inv.status === 'paid' ? "var(--ok)" : "var(--warn)",
                        fontFamily: "var(--font-mono)", fontSize: 11, textTransform: "uppercase"
                      }}>
                        {inv.status}
                      </span>
                    </td>
                    <td style={{ padding: 12, textAlign: "right" }}>
                      {inv.invoiceUrl ? (
                        <a href={inv.invoiceUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", textDecoration: "none", fontSize: 12, fontWeight: 500 }}>
                          View
                        </a>
                      ) : (
                        <span style={{ color: "var(--ink-muted)", fontSize: 12 }}>N/A</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}