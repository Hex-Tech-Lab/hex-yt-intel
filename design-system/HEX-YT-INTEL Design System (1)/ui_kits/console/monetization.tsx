import React, { ReactNode, CSSProperties } from "react";

/* ============================================================================
   MONETIZATION PRIMITIVES
   Stateless adapters for Stripe flow. React 19: ref as normal prop.
   ========================================================================= */

type PlanInterval = "monthly" | "annual";
type PromoType = "gift_card" | "referral";
type PromoStatus = "active" | "used" | "expired";
type SubscriptionStatus = "active" | "past_due" | "canceled" | "trialing";

interface Plan {
  id: string;
  name: string;
  interval: PlanInterval;
  price: number;
  description?: string;
  features: string[];
  badge?: string;
}

interface Addon {
  id: string;
  name: string;
  description: string;
  price: number;
  enabled: boolean;
}

interface Promo {
  code: string;
  type: PromoType;
  amount: number;
  expiresAt: number; // unix timestamp
  used: boolean;
  usedAt?: number;
}

interface Referral {
  id: string;
  code: string;
  refereeName?: string;
  status: "pending" | "redeemed" | "expired";
  rewardAmount: number;
  expiresAt: number;
}

/* ============================================================================
   PLAN SELECTOR
   ========================================================================= */

interface PlanSelectorProps {
  plans: Plan[];
  selectedId: string;
  onSelect: (planId: string) => void;
  theme: "light" | "dark";
  style?: CSSProperties;
}

export function PlanSelector({
  plans,
  selectedId,
  onSelect,
  theme,
  style = {},
}: PlanSelectorProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 16,
        ...style,
      }}
    >
      {plans.map((plan) => {
        const selected = plan.id === selectedId;
        return (
          <button
            key={plan.id}
            type="button"
            onClick={() => onSelect(plan.id)}
            style={{
              display: "flex",
              flexDirection: "column",
              padding: 24,
              borderRadius: 12,
              border: selected
                ? `2px solid var(--accent)`
                : `1px solid var(--line)`,
              background: selected
                ? "rgb(6 182 212 / 0.10)"
                : "var(--surface)",
              cursor: "pointer",
              transition: "all var(--dur-base)",
              textAlign: "left",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: 16,
                  fontWeight: 600,
                  color: "var(--ink)",
                }}
              >
                {plan.name}
              </h3>
              {plan.badge && (
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    background: "var(--accent-strong)",
                    color: "var(--void)",
                    padding: "2px 8px",
                    borderRadius: 4,
                  }}
                >
                  {plan.badge}
                </span>
              )}
            </div>
            <p
              style={{
                margin: "0 0 16px 0",
                fontSize: 13,
                color: "var(--ink-secondary)",
              }}
            >
              {plan.description}
            </p>
            <p
              style={{
                margin: 0,
                fontSize: 28,
                fontWeight: 700,
                color: "var(--accent)",
              }}
            >
              ${plan.price}
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 400,
                  color: "var(--ink-secondary)",
                  marginLeft: 4,
                }}
              >
                /{plan.interval === "monthly" ? "mo" : "yr"}
              </span>
            </p>
            <ul
              style={{
                margin: "16px 0 0 0",
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {plan.features.map((feature) => (
                <li
                  key={feature}
                  style={{
                    fontSize: 13,
                    color: "var(--ink-secondary)",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span style={{ color: "var(--ok)" }}>✓</span> {feature}
                </li>
              ))}
            </ul>
          </button>
        );
      })}
    </div>
  );
}

/* ============================================================================
   ADDON TOGGLE
   ========================================================================= */

interface AddonToggleProps {
  addons: Addon[];
  onToggle: (addonId: string, enabled: boolean) => void;
  style?: CSSProperties;
}

export function AddonToggle({ addons, onToggle, style = {} }: AddonToggleProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, ...style }}>
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
            background: "var(--surface)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={addon.enabled}
            onChange={(e) => onToggle(addon.id, e.target.checked)}
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
                fontSize: 14,
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
              fontSize: 14,
              fontWeight: 600,
              color: "var(--accent)",
            }}
          >
            +${addon.price}
          </p>
        </label>
      ))}
    </div>
  );
}

/* ============================================================================
   PROMO INPUT
   ========================================================================= */

interface PromoInputProps {
  value: string;
  onChange: (v: string) => void;
  onApply: () => void;
  error?: string;
  success?: string;
  disabled?: boolean;
  style?: CSSProperties;
}

export function PromoInput({
  value,
  onChange,
  onApply,
  error,
  success,
  disabled = false,
  style = {},
}: PromoInputProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, ...style }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter promo code (e.g., ABC123)"
          disabled={disabled}
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            color: "var(--ink)",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            outline: "none",
            opacity: disabled ? 0.5 : 1,
          }}
        />
        <button
          type="button"
          onClick={onApply}
          disabled={disabled || !value}
          style={{
            padding: "10px 16px",
            borderRadius: 8,
            border: "none",
            background: "var(--accent-strong)",
            color: "var(--void)",
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            fontWeight: 500,
            cursor: disabled || !value ? "not-allowed" : "pointer",
            opacity: disabled || !value ? 0.4 : 1,
          }}
        >
          Apply
        </button>
      </div>
      {error && (
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: "var(--err)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {error}
        </p>
      )}
      {success && (
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: "var(--ok)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {success}
        </p>
      )}
    </div>
  );
}

/* ============================================================================
   PROMO CARD (DASHBOARD)
   ========================================================================= */

interface PromoCardProps {
  promo: Promo;
  onRedeem?: () => void;
  onShare?: () => void;
  daysLeft: number;
  theme: "light" | "dark";
}

export function PromoCard({
  promo,
  onRedeem,
  onShare,
  daysLeft,
  theme,
}: PromoCardProps) {
  const statusColor =
    promo.used || daysLeft === 0
      ? "var(--ink-muted)"
      : daysLeft <= 3
        ? "var(--err)"
        : "var(--ok)";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: 12,
        borderRadius: 8,
        border: "1px solid var(--line)",
        background: "var(--surface)",
      }}
    >
      <div style={{ flex: 1 }}>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            fontFamily: "var(--font-mono)",
            fontWeight: 600,
            color: "var(--ink)",
          }}
        >
          {promo.code}
        </p>
        <div
          style={{
            display: "flex",
            gap: 12,
            marginTop: 6,
            fontSize: 12,
            color: "var(--ink-secondary)",
          }}
        >
          <span>
            {promo.type === "gift_card" ? "Gift Card" : "Referral"} • ${promo.amount / 100}
          </span>
          <span style={{ color: statusColor }}>
            {promo.used
              ? "Used"
              : daysLeft === 0
                ? "Expired"
                : `${daysLeft} days left`}
          </span>
        </div>
      </div>
      {!promo.used && daysLeft > 0 && (
        <>
          {promo.type === "gift_card" && onRedeem && (
            <button
              type="button"
              onClick={onRedeem}
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                border: "none",
                background: "var(--accent-strong)",
                color: "var(--void)",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Redeem
            </button>
          )}
          {promo.type === "referral" && onShare && (
            <button
              type="button"
              onClick={onShare}
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                border: "1px solid var(--line)",
                background: "transparent",
                color: "var(--ink-secondary)",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Share
            </button>
          )}
        </>
      )}
    </div>
  );
}

/* ============================================================================
   REFERRAL INVITE
   ========================================================================= */

interface ReferralInviteProps {
  referralCode?: string;
  onInvite: () => void;
  onCopy?: () => void;
  loading?: boolean;
}

export function ReferralInvite({
  referralCode,
  onInvite,
  onCopy,
  loading = false,
}: ReferralInviteProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 16,
        borderRadius: 8,
        border: "1px solid var(--line)",
        background: "var(--surface)",
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
        Invite a Friend
      </h3>
      {referralCode ? (
        <>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: "var(--ink-secondary)",
            }}
          >
            Share this code with your friends to earn rewards:
          </p>
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
            }}
          >
            <code
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: 6,
                background: "var(--bg)",
                border: "1px solid var(--line)",
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                color: "var(--accent)",
              }}
            >
              {referralCode}
            </code>
            <button
              type="button"
              onClick={onCopy}
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                border: "none",
                background: "var(--accent-strong)",
                color: "var(--void)",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Copy
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={onInvite}
          disabled={loading}
          style={{
            padding: "10px 12px",
            borderRadius: 6,
            border: "1px solid var(--line)",
            background: "transparent",
            color: "var(--accent)",
            fontSize: 13,
            fontWeight: 500,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.5 : 1,
          }}
        >
          {loading ? "Generating..." : "Generate Referral Code"}
        </button>
      )}
    </div>
  );
}

export type { Plan, Addon, Promo, Referral };
