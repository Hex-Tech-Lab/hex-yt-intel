import React, { CSSProperties } from "react";
import type { Promo, Referral, Addon, SubscriptionStatus } from "./monetization";

/* ============================================================================
   DASHBOARD SECTIONS
   Stateless adapters for monetization dashboard.
   ========================================================================= */

interface SubscriptionOverviewProps {
  planName: string;
  interval: "monthly" | "annual";
  renewalDate: string;
  status: SubscriptionStatus;
  activeAddons: string[];
  onManageBilling: () => void;
  theme: "light" | "dark";
  style?: CSSProperties;
}

export function SubscriptionOverview({
  planName,
  interval,
  renewalDate,
  status,
  activeAddons,
  onManageBilling,
  theme,
  style = {},
}: SubscriptionOverviewProps) {
  const statusColor =
    status === "active"
      ? "var(--ok)"
      : status === "trialing"
        ? "var(--accent)"
        : "var(--err)";

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
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 600,
            color: "var(--ink)",
          }}
        >
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
          {status}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 16,
        }}
      >
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
            Current Plan
          </p>
          <p
            style={{
              margin: "4px 0 0 0",
              fontSize: 16,
              fontWeight: 600,
              color: "var(--ink)",
            }}
          >
            {planName}
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
            Renewal Date
          </p>
          <p
            style={{
              margin: "4px 0 0 0",
              fontSize: 16,
              fontWeight: 600,
              color: "var(--ink)",
            }}
          >
            {renewalDate}
          </p>
        </div>
      </div>

      {activeAddons.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <p
            style={{
              margin: 0,
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.08em",
              color: "var(--ink-muted)",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            Active Add-Ons
          </p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {activeAddons.map((addon) => (
              <span
                key={addon}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  borderRadius: 6,
                  border: "1px solid var(--line)",
                  background: "rgb(6 182 212 / 0.10)",
                  padding: "4px 10px",
                  fontSize: 12,
                  color: "var(--accent-ink)",
                }}
              >
                ✓ {addon}
              </span>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onManageBilling}
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
        }}
      >
        Manage in Billing Portal
      </button>
    </div>
  );
}

/* ============================================================================
   PROMO BANNER
   Full-width alert for expiring promos.
   ========================================================================= */

interface PromoBannerProps {
  promos: Promo[];
  onDismiss?: () => void;
  theme: "light" | "dark";
  style?: CSSProperties;
}

export function PromoBanner({
  promos,
  onDismiss,
  theme,
  style = {},
}: PromoBannerProps) {
  const expiring = promos.filter((p) => {
    const daysLeft = Math.floor(
      (p.expiresAt * 1000 - Date.now()) / (1000 * 60 * 60 * 24)
    );
    return !p.used && daysLeft > 0 && daysLeft <= 7;
  });

  if (expiring.length === 0) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        padding: 12,
        borderRadius: 8,
        borderLeft: "4px solid var(--err)",
        background: "rgb(239 68 68 / 0.10)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        ...style,
      }}
    >
      <div>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 500,
            color: "var(--err)",
          }}
        >
          ⚠️ Promo expiring soon
        </p>
        <p
          style={{
            margin: "4px 0 0 0",
            fontSize: 12,
            color: "var(--ink-secondary)",
          }}
        >
          {expiring[0].code} expires in{" "}
          {Math.floor(
            (expiring[0].expiresAt * 1000 - Date.now()) / (1000 * 60 * 60 * 24)
          )}{" "}
          days
        </p>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss banner"
          style={{
            padding: "4px 8px",
            borderRadius: 4,
            border: "none",
            background: "transparent",
            color: "var(--err)",
            cursor: "pointer",
            fontSize: 16,
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

/* ============================================================================
   PROMOS TABLE
   ========================================================================= */

interface PromosTableProps {
  promos: Promo[];
  onRedeem?: (code: string) => void;
  onShare?: (code: string) => void;
  theme: "light" | "dark";
  style?: CSSProperties;
}

export function PromosTable({
  promos,
  onRedeem,
  onShare,
  theme,
  style = {},
}: PromosTableProps) {
  if (promos.length === 0) {
    return (
      <div
        style={{
          padding: 20,
          textAlign: "center",
          borderRadius: 8,
          border: "1px solid var(--line)",
          background: "var(--surface)",
          ...style,
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "var(--ink-secondary)",
          }}
        >
          No active promos yet.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        borderRadius: 8,
        border: "1px solid var(--line)",
        overflow: "hidden",
        ...style,
      }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 13,
        }}
      >
        <thead>
          <tr
            style={{
              background: "var(--bg)",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <th
              style={{
                padding: 12,
                textAlign: "left",
                fontWeight: 600,
                color: "var(--ink-muted)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Code
            </th>
            <th
              style={{
                padding: 12,
                textAlign: "left",
                fontWeight: 600,
                color: "var(--ink-muted)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Type
            </th>
            <th
              style={{
                padding: 12,
                textAlign: "left",
                fontWeight: 600,
                color: "var(--ink-muted)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Value
            </th>
            <th
              style={{
                padding: 12,
                textAlign: "left",
                fontWeight: 600,
                color: "var(--ink-muted)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Status
            </th>
            <th
              style={{
                padding: 12,
                textAlign: "right",
                fontWeight: 600,
                color: "var(--ink-muted)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {promos.map((promo) => {
            const daysLeft = Math.floor(
              (promo.expiresAt * 1000 - Date.now()) / (1000 * 60 * 60 * 24)
            );
            const statusText =
              promo.used || daysLeft <= 0
                ? promo.used
                  ? "Used"
                  : "Expired"
                : `${daysLeft} days`;
            const statusColor =
              promo.used || daysLeft <= 0
                ? "var(--ink-muted)"
                : daysLeft <= 3
                  ? "var(--err)"
                  : "var(--ok)";

            return (
              <tr
                key={promo.code}
                style={{
                  borderBottom: "1px solid var(--line)",
                  background: "var(--surface)",
                }}
              >
                <td
                  style={{
                    padding: 12,
                    fontFamily: "var(--font-mono)",
                    fontWeight: 500,
                    color: "var(--accent)",
                  }}
                >
                  {promo.code}
                </td>
                <td style={{ padding: 12, color: "var(--ink-secondary)" }}>
                  {promo.type === "gift_card" ? "Gift Card" : "Referral"}
                </td>
                <td
                  style={{
                    padding: 12,
                    fontWeight: 600,
                    color: "var(--ink)",
                  }}
                >
                  ${promo.amount / 100}
                </td>
                <td style={{ padding: 12, color: statusColor }}>
                  {statusText}
                </td>
                <td
                  style={{
                    padding: 12,
                    textAlign: "right",
                  }}
                >
                  {!promo.used && daysLeft > 0 ? (
                    <>
                      {promo.type === "gift_card" && onRedeem && (
                        <button
                          type="button"
                          onClick={() => onRedeem(promo.code)}
                          style={{
                            padding: "6px 10px",
                            borderRadius: 4,
                            border: "none",
                            background: "var(--accent-strong)",
                            color: "var(--void)",
                            fontSize: 11,
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
                          onClick={() => onShare(promo.code)}
                          style={{
                            padding: "6px 10px",
                            borderRadius: 4,
                            border: "1px solid var(--line)",
                            background: "transparent",
                            color: "var(--ink-secondary)",
                            fontSize: 11,
                            fontWeight: 500,
                            cursor: "pointer",
                          }}
                        >
                          Share
                        </button>
                      )}
                    </>
                  ) : (
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--ink-muted)",
                      }}
                    >
                      —
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ============================================================================
   REFERRAL HISTORY
   ========================================================================= */

interface ReferralHistoryProps {
  referrals: Referral[];
  theme: "light" | "dark";
  style?: CSSProperties;
}

export function ReferralHistory({
  referrals,
  theme,
  style = {},
}: ReferralHistoryProps) {
  if (referrals.length === 0) {
    return (
      <div
        style={{
          padding: 20,
          textAlign: "center",
          borderRadius: 8,
          border: "1px solid var(--line)",
          background: "var(--surface)",
          ...style,
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "var(--ink-secondary)",
          }}
        >
          No referrals yet. Invite a friend to get started.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        ...style,
      }}
    >
      {referrals.map((ref) => (
        <div
          key={ref.id}
          style={{
            padding: 12,
            borderRadius: 8,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                fontWeight: 500,
                color: "var(--ink)",
              }}
            >
              {ref.refereeName || "Friend"}
            </p>
            <p
              style={{
                margin: "4px 0 0 0",
                fontSize: 11,
                color: "var(--ink-secondary)",
              }}
            >
              Reward: ${ref.rewardAmount / 100}
            </p>
          </div>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              borderRadius: 4,
              border: "1px solid var(--line)",
              background:
                ref.status === "redeemed"
                  ? "rgb(34 197 94 / 0.10)"
                  : "rgb(31 41 55 / 0.6)",
              padding: "4px 8px",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 600,
              color:
                ref.status === "redeemed"
                  ? "var(--ok)"
                  : "var(--ink-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {ref.status === "redeemed" && "✓"} {ref.status}
          </span>
        </div>
      ))}
    </div>
  );
}
