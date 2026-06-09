import React, { useState, CSSProperties } from "react";

/* ============================================================================
   CHECKOUT FLOW
   Multi-step stateless checkout. Data flows: UI → API → Stripe redirect.
   ========================================================================= */

type CheckoutStep = "plan" | "addons" | "promo" | "review" | "loading" | "success" | "error";

interface CheckoutProps {
  plans: Array<{
    id: string;
    name: string;
    price: number;
    interval: "monthly" | "annual";
    description?: string;
    features: string[];
    badge?: string;
  }>;
  addons: Array<{
    id: string;
    name: string;
    description: string;
    price: number;
  }>;
  onCheckout: (payload: {
    email: string;
    planId: string;
    addonIds: string[];
    promoCode?: string;
  }) => Promise<{ sessionId: string; url: string }>;
  onCancel?: () => void;
  theme: "light" | "dark";
}

export function Checkout({
  plans,
  addons,
  onCheckout,
  onCancel,
  theme,
}: CheckoutProps) {
  const [step, setStep] = useState<CheckoutStep>("plan");
  const [email, setEmail] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [selectedAddons, setSelectedAddons] = useState<Set<string>>(new Set());
  const [promoCode, setPromoCode] = useState("");
  const [promoError, setPromoError] = useState("");
  const [promoSuccess, setPromoSuccess] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handlePlanSelect = (planId: string) => {
    setSelectedPlan(planId);
  };

  const handleAddonToggle = (addonId: string) => {
    const newAddons = new Set(selectedAddons);
    if (newAddons.has(addonId)) {
      newAddons.delete(addonId);
    } else {
      newAddons.add(addonId);
    }
    setSelectedAddons(newAddons);
  };

  const handlePromoApply = async () => {
    setPromoError("");
    setPromoSuccess("");

    if (!promoCode.trim()) {
      setPromoError("Enter a promo code");
      return;
    }

    // Simulate validation (real: call /api/validate-promo)
    if (promoCode.toUpperCase().startsWith("INVALID")) {
      setPromoError("Promo code not found or expired");
    } else {
      setPromoSuccess(`${promoCode} applied! You save $5.`);
    }
  };

  const handleCheckout = async () => {
    if (!email || !validateEmail(email)) {
      setError("Valid email required");
      return;
    }
    if (!selectedPlan) {
      setError("Select a plan");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const result = await onCheckout({
        email,
        planId: selectedPlan,
        addonIds: Array.from(selectedAddons),
        promoCode: promoCode.trim() || undefined,
      });

      // Redirect to Stripe Checkout
      if (result.url) {
        window.location.href = result.url;
      }
    } catch (err) {
      setError(err.message || "Checkout failed");
      setLoading(false);
    }
  };

  const selectedPlanData = plans.find((p) => p.id === selectedPlan);
  const selectedAddonData = addons.filter((a) => selectedAddons.has(a.id));

  const subtotal = (selectedPlanData?.price || 0) + selectedAddonData.reduce((sum, a) => sum + a.price, 0);

  return (
    <div
      style={{
        maxWidth: 800,
        margin: "0 auto",
        padding: "40px 24px",
        borderRadius: 16,
        border: "1px solid var(--line)",
        background: "var(--surface)",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "var(--ink)" }}>
          Get started
        </h1>
        <p style={{ margin: "8px 0 0 0", fontSize: 14, color: "var(--ink-secondary)" }}>
          {step === "plan" && "Choose your plan"}
          {step === "addons" && "Add optional features"}
          {step === "promo" && "Have a promo code?"}
          {step === "review" && "Review your order"}
        </p>
      </div>

      {/* Step indicators */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 32,
          fontSize: 12,
        }}
      >
        {["plan", "addons", "promo", "review"].map((s, i) => {
          const isActive = s === step;
          const isComplete = ["plan", "addons", "promo", "review"].indexOf(step) > i;
          return (
            <div
              key={s}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flex: 1,
              }}
            >
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  border: isActive ? "2px solid var(--accent)" : "1px solid var(--line)",
                  background: isComplete ? "var(--accent-strong)" : "transparent",
                  display: "grid",
                  placeItems: "center",
                  color: isComplete ? "var(--void)" : "var(--ink-muted)",
                  fontWeight: 600,
                  fontSize: 11,
                }}
              >
                {isComplete ? "✓" : i + 1}
              </span>
              <span
                style={{
                  color: isActive ? "var(--accent)" : "var(--ink-muted)",
                  fontWeight: isActive ? 500 : 400,
                  textTransform: "capitalize",
                }}
              >
                {s}
              </span>
            </div>
          );
        })}
      </div>

      {/* Step: Plan */}
      {step === "plan" && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
            {plans.map((plan) => {
              const selected = plan.id === selectedPlan;
              return (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => handlePlanSelect(plan.id)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    padding: 16,
                    borderRadius: 8,
                    border: selected ? "2px solid var(--accent)" : "1px solid var(--line)",
                    background: selected ? "rgb(6 182 212 / 0.10)" : "var(--bg)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 8,
                    }}
                  >
                    <h3
                      style={{
                        margin: 0,
                        fontSize: 14,
                        fontWeight: 600,
                        color: "var(--ink)",
                      }}
                    >
                      {plan.name}
                    </h3>
                    {plan.badge && (
                      <span
                        style={{
                          fontSize: 10,
                          fontFamily: "var(--font-mono)",
                          fontWeight: 600,
                          letterSpacing: "0.08em",
                          background: "var(--accent-strong)",
                          color: "var(--void)",
                          padding: "2px 6px",
                          borderRadius: 3,
                        }}
                      >
                        {plan.badge}
                      </span>
                    )}
                  </div>
                  <p
                    style={{
                      margin: "0 0 8px 0",
                      fontSize: 12,
                      color: "var(--ink-secondary)",
                    }}
                  >
                    {plan.description}
                  </p>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 20,
                      fontWeight: 700,
                      color: "var(--accent)",
                    }}
                  >
                    ${plan.price}
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 400,
                        color: "var(--ink-secondary)",
                        marginLeft: 4,
                      }}
                    >
                      /{plan.interval === "monthly" ? "mo" : "yr"}
                    </span>
                  </p>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setStep("addons")}
            disabled={!selectedPlan}
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: 8,
              border: "none",
              background: "var(--accent-strong)",
              color: "var(--void)",
              fontSize: 14,
              fontWeight: 500,
              cursor: !selectedPlan ? "not-allowed" : "pointer",
              opacity: !selectedPlan ? 0.4 : 1,
            }}
          >
            Continue to Add-Ons
          </button>
        </div>
      )}

      {/* Step: Add-ons */}
      {step === "addons" && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
            {addons.map((addon) => (
              <label
                key={addon.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: 12,
                  borderRadius: 8,
                  border: "1px solid var(--line)",
                  background: "var(--bg)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedAddons.has(addon.id)}
                  onChange={() => handleAddonToggle(addon.id)}
                  style={{
                    width: 18,
                    height: 18,
                    accentColor: "var(--accent)",
                    cursor: "pointer",
                  }}
                />
                <div style={{ flex: 1 }}>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--ink)",
                    }}
                  >
                    {addon.name}
                  </p>
                  <p
                    style={{
                      margin: "4px 0 0 0",
                      fontSize: 12,
                      color: "var(--ink-secondary)",
                    }}
                  >
                    {addon.description}
                  </p>
                </div>
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--accent)",
                  }}
                >
                  +${addon.price}
                </p>
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button
              type="button"
              onClick={() => setStep("plan")}
              style={{
                flex: 1,
                padding: "12px 16px",
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "transparent",
                color: "var(--ink-secondary)",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => setStep("promo")}
              style={{
                flex: 1,
                padding: "12px 16px",
                borderRadius: 8,
                border: "none",
                background: "var(--accent-strong)",
                color: "var(--void)",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step: Promo */}
      {step === "promo" && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ marginBottom: 24 }}>
            <label
              style={{
                display: "flex",
                gap: 8,
              }}
            >
              <input
                type="text"
                value={promoCode}
                onChange={(e) => {
                  setPromoCode(e.target.value);
                  setPromoError("");
                  setPromoSuccess("");
                }}
                placeholder="Enter promo code (optional)"
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--line)",
                  background: "var(--bg)",
                  color: "var(--ink)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 13,
                  outline: "none",
                }}
              />
              <button
                type="button"
                onClick={handlePromoApply}
                disabled={!promoCode.trim()}
                style={{
                  padding: "10px 16px",
                  borderRadius: 8,
                  border: "none",
                  background: "var(--accent-strong)",
                  color: "var(--void)",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: !promoCode.trim() ? "not-allowed" : "pointer",
                  opacity: !promoCode.trim() ? 0.4 : 1,
                }}
              >
                Apply
              </button>
            </label>
            {promoError && (
              <p
                style={{
                  margin: "8px 0 0 0",
                  fontSize: 12,
                  color: "var(--err)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {promoError}
              </p>
            )}
            {promoSuccess && (
              <p
                style={{
                  margin: "8px 0 0 0",
                  fontSize: 12,
                  color: "var(--ok)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                ✓ {promoSuccess}
              </p>
            )}
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button
              type="button"
              onClick={() => setStep("addons")}
              style={{
                flex: 1,
                padding: "12px 16px",
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "transparent",
                color: "var(--ink-secondary)",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => setStep("review")}
              style={{
                flex: 1,
                padding: "12px 16px",
                borderRadius: 8,
                border: "none",
                background: "var(--accent-strong)",
                color: "var(--void)",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Review Order
            </button>
          </div>
        </div>
      )}

      {/* Step: Review */}
      {step === "review" && (
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              padding: 16,
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--bg)",
              marginBottom: 24,
            }}
          >
            <h3
              style={{
                margin: "0 0 12px 0",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ink)",
              }}
            >
              Order Summary
            </h3>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                fontSize: 13,
              }}
            >
              {selectedPlanData && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    paddingBottom: 8,
                    borderBottom: "1px solid var(--line)",
                  }}
                >
                  <span>
                    {selectedPlanData.name} ({selectedPlanData.interval})
                  </span>
                  <span style={{ fontWeight: 600, color: "var(--ink)" }}>
                    ${selectedPlanData.price}
                  </span>
                </div>
              )}
              {selectedAddonData.map((addon) => (
                <div
                  key={addon.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    paddingBottom: 8,
                    borderBottom: "1px solid var(--line)",
                  }}
                >
                  <span>{addon.name}</span>
                  <span style={{ fontWeight: 600, color: "var(--ink)" }}>
                    +${addon.price}
                  </span>
                </div>
              ))}
              {promoSuccess && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    paddingBottom: 8,
                    borderBottom: "1px solid var(--line)",
                    color: "var(--ok)",
                  }}
                >
                  <span>{promoCode}</span>
                  <span>-$5</span>
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: 8,
                  fontSize: 16,
                  fontWeight: 700,
                  color: "var(--accent)",
                }}
              >
                <span>Total</span>
                <span>${Math.max(0, subtotal - (promoSuccess ? 5 : 0))}</span>
              </div>
            </div>
          </div>

          {/* Email */}
          <label style={{ display: "flex", flexDirection: "column", marginBottom: 24 }}>
            <span
              style={{
                marginBottom: 6,
                fontSize: 12,
                fontWeight: 500,
                color: "var(--ink-muted)",
              }}
            >
              Email for receipt
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "var(--bg)",
                color: "var(--ink)",
                fontFamily: "var(--font-sans)",
                fontSize: 13,
                outline: "none",
              }}
            />
          </label>

          {error && (
            <div
              style={{
                padding: 12,
                borderRadius: 8,
                background: "rgb(239 68 68 / 0.10)",
                borderLeft: "3px solid var(--err)",
                marginBottom: 24,
              }}
            >
              <p style={{ margin: 0, fontSize: 12, color: "var(--err)" }}>
                {error}
              </p>
            </div>
          )}

          <div style={{ display: "flex", gap: 12 }}>
            <button
              type="button"
              onClick={() => setStep("promo")}
              style={{
                flex: 1,
                padding: "12px 16px",
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "transparent",
                color: "var(--ink-secondary)",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleCheckout}
              disabled={!email || loading}
              style={{
                flex: 1,
                padding: "12px 16px",
                borderRadius: 8,
                border: "none",
                background: "var(--accent-strong)",
                color: "var(--void)",
                fontSize: 14,
                fontWeight: 500,
                cursor: !email || loading ? "not-allowed" : "pointer",
                opacity: !email || loading ? 0.4 : 1,
              }}
            >
              {loading ? "Processing..." : "Complete Purchase"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
