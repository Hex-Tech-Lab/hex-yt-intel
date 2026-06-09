import React, { useEffect, useState, ReactNode } from "react";

/* ============================================================================
   BILLING PORTAL INTEGRATION
   Stateless adapters for Stripe Billing Portal flows.
   ========================================================================= */

interface BillingPortalLinkProps {
  customerId: string;
  onPortalOpen?: (url: string) => void;
  loading?: boolean;
  error?: string;
  label?: string;
  theme: "light" | "dark";
  style?: React.CSSProperties;
}

export function BillingPortalLink({
  customerId,
  onPortalOpen,
  loading = false,
  error,
  label = "Manage in Billing Portal",
  theme,
  style = {},
}: BillingPortalLinkProps) {
  const handleClick = async () => {
    try {
      // Call /api/billing-portal?customerId=X&returnUrl=...
      const response = await fetch(
        `/api/billing-portal?customerId=${encodeURIComponent(customerId)}&returnUrl=${encodeURIComponent(window.location.href)}`,
        { method: "GET" }
      );

      if (!response.ok) throw new Error("Failed to create billing portal session");

      const { url } = await response.json();

      // Optional callback before redirect
      onPortalOpen?.(url);

      // Redirect to Stripe-hosted portal
      window.location.href = url;
    } catch (err) {
      console.error("Billing portal error:", err);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      aria-label={label}
      style={{
        padding: "10px 16px",
        borderRadius: 8,
        border: error ? "1px solid var(--err)" : "1px solid var(--line)",
        background: "transparent",
        color: error ? "var(--err)" : "var(--accent)",
        fontFamily: "var(--font-sans)",
        fontSize: 13,
        fontWeight: 500,
        cursor: loading ? "not-allowed" : "pointer",
        opacity: loading ? 0.5 : 1,
        transition: "all var(--dur-fast)",
        ...style,
      }}
    >
      {loading ? "Opening..." : label}
    </button>
  );
}

/* ============================================================================
   BILLING PORTAL RETURN HANDLER
   Detects return from Stripe portal and shows confirmation.
   ========================================================================= */

interface BillingPortalReturnProps {
  onReturn?: () => void;
  theme: "light" | "dark";
}

export function BillingPortalReturn({
  onReturn,
  theme,
}: BillingPortalReturnProps) {
  const [showReturn, setShowReturn] = useState(false);

  useEffect(() => {
    // Check if returning from Stripe (URL search param or sessionStorage)
    const params = new URLSearchParams(window.location.search);
    const fromPortal = params.get("from_portal") === "true" || 
                       sessionStorage.getItem("stripe_portal_return");

    if (fromPortal) {
      setShowReturn(true);
      sessionStorage.removeItem("stripe_portal_return");
      onReturn?.();

      // Auto-dismiss after 6s
      setTimeout(() => setShowReturn(false), 6000);
    }
  }, [onReturn]);

  if (!showReturn) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: 12,
        borderRadius: 8,
        borderLeft: "4px solid var(--ok)",
        background: "rgb(34 197 94 / 0.10)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 16,
      }}
    >
      <p style={{ margin: 0, fontSize: 13, color: "var(--ok)", fontWeight: 500 }}>
        ✓ Billing settings updated successfully
      </p>
      <button
        type="button"
        onClick={() => setShowReturn(false)}
        aria-label="Dismiss"
        style={{
          border: "none",
          background: "transparent",
          color: "var(--ok)",
          cursor: "pointer",
          fontSize: 16,
        }}
      >
        ✕
      </button>
    </div>
  );
}

/* ============================================================================
   SUBSCRIPTION MANAGEMENT PANEL
   Shows current subscription + quick actions.
   ========================================================================= */

interface SubscriptionStatus {
  id: string;
  status: "active" | "past_due" | "canceled" | "trialing";
  currentPeriodStart: number;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  planName: string;
  planInterval: "monthly" | "annual";
  nextInvoiceDate?: number;
}

interface SubscriptionPanelProps {
  subscription: SubscriptionStatus;
  customerId: string;
  onPortalOpen?: (url: string) => void;
  theme: "light" | "dark";
  style?: React.CSSProperties;
}

export function SubscriptionPanel({
  subscription,
  customerId,
  onPortalOpen,
  theme,
  style = {},
}: SubscriptionPanelProps) {
  const statusColor =
    subscription.status === "active"
      ? "var(--ok)"
      : subscription.status === "past_due"
        ? "var(--err)"
        : subscription.status === "trialing"
          ? "var(--accent)"
          : "var(--ink-muted)";

  const currentPeriodEndDate = new Date(subscription.currentPeriodEnd * 1000).toLocaleDateString();

  return (
    <div
      style={{
        padding: 20,
        borderRadius: 12,
        border: "1px solid var(--line)",
        background: "var(--surface)",
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "var(--ink)" }}>
          Subscription
        </h2>
        <span
          style={{
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
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: statusColor,
            }}
          />
          {subscription.status}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div>
          <p
            style={{
              margin: 0,
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.08em",
              color: "var(--ink-muted)",
              textTransform: "uppercase",
            }}
          >
            Plan
          </p>
          <p
            style={{
              margin: "4px 0 0 0",
              fontSize: 16,
              fontWeight: 600,
              color: "var(--ink)",
            }}
          >
            {subscription.planName} ({subscription.planInterval})
          </p>
        </div>
        <div>
          <p
            style={{
              margin: 0,
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.08em",
              color: "var(--ink-muted)",
              textTransform: "uppercase",
            }}
          >
            Next Billing Date
          </p>
          <p
            style={{
              margin: "4px 0 0 0",
              fontSize: 16,
              fontWeight: 600,
              color: "var(--ink)",
            }}
          >
            {currentPeriodEndDate}
          </p>
        </div>
      </div>

      {subscription.status === "past_due" && (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            background: "rgb(239 68 68 / 0.10)",
            borderLeft: "3px solid var(--err)",
            marginBottom: 16,
          }}
        >
          <p style={{ margin: 0, fontSize: 12, color: "var(--err)", fontWeight: 500 }}>
            Payment past due. Update your billing info to continue service.
          </p>
        </div>
      )}

      {subscription.cancelAtPeriodEnd && (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            background: "rgb(239 68 68 / 0.10)",
            borderLeft: "3px solid var(--err)",
            marginBottom: 16,
          }}
        >
          <p style={{ margin: 0, fontSize: 12, color: "var(--err)", fontWeight: 500 }}>
            Your subscription is scheduled to cancel on {currentPeriodEndDate}.
          </p>
        </div>
      )}

      <BillingPortalLink
        customerId={customerId}
        onPortalOpen={onPortalOpen}
        label={
          subscription.status === "past_due"
            ? "Update Payment Method"
            : "Manage Subscription"
        }
        theme={theme}
        style={{ width: "100%" }}
      />
    </div>
  );
}
