# PR #325 (tier vocabulary step 1) — external review, 2026-09-24 (head 19369af)

Saved verbatim-in-substance for the next session (raw findings for an OC round-3 dispatch; verify each before acting).

Checks: 31 pass, 1 fail (DeepSource JS web). 48 unresolved threads.

P1 release blockers:
1. `pricing.ts` / `PaddleBillingAdapter.ts`: checkout honors `PADDLE_PRO_ANNUAL_PRICE_ID` and `PADDLE_FOUNDER_PRICE_ID`, but `resolveUserTierForPriceId()` only recognizes the monthly Pro env override + registry values → annual Pro and founder purchases can succeed without granting the tier. One canonical resolver for checkout and webhooks; tests for Pro monthly/annual, founder, Light, Max, unknown.
2. Cancellation writes `users.tier = free` unconditionally → cancelling one subscription downgrades a user with another active one. Recompute from all active subscriptions; out-of-order + multi-subscription tests.
3. Runtime code treats any non-`free` string as paid (`tier !== 'free'`, `as UserTier` casts on DB values). Add `normalizeUserTier()` allowlist (unknown/legacy → free) used in quota, model cascade, billing display, auth.
4. `CheckoutSchema` now accepts Light/Max globally, but only the Paddle branch was widened → other providers (Stripe/LemonSqueezy) may mishandle. Support consistently or reject per provider.
5. Both Paddle webhook routes retained → possible double processing. Verify registered URL, delete the other, or add event idempotency.
6. `users.tier` stores Light/Max but `user_subscriptions.plan_tier` is clamped to `pro` by the unchanged DB CHECK → two entitlement stores disagree (step 2 / DB).
7. DeepSource failing (complexity, missing docs, global functions) → extract small mapping helpers, keep fail-closed.
8. DECISION: `export/route.ts` `FULL_REPORT_TIERS` now includes Light (unapproved). Remove Light until approved.

P2:
- `chat.turnLimit.light/max` registry rows missing → repeated lookups/fallback per chat request (seed in step 2 or cache misses).
- Tier resolved from `items[0].price.id` only → add-ons/reordered items can resolve wrong; pick the recognized plan price among all items, reject ambiguity.
- Billing UI indexes `STRIPE_PRICING` by tier and silently falls back to Free pricing for Light/Max.
- Tangent (out of diff): `web/lib/stripe/webhook-handlers.ts` reportedly still hardcodes `pro` on subscription — same bug class; audit if Stripe is enabled.

Verify before approval: prod `billing.priceIds` (annual/founder IDs), Paddle dashboard webhook URL, DB constraint + all reads of `user_subscriptions.plan_tier`, whether Stripe is enabled in prod, multi-subscription possibility.
