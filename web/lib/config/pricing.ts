import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';

/**
 * Settings-Registry-based multi-provider price-ID structure (2026-08-18).
 *
 * Real MoR shortlist for hex-yt-intel: Paddle (primary; sandbox-only today --
 * the account is not yet KYC-verified, not a caution/hold-back decision, just
 * what's actually available to transact against right now), Dodo Payments
 * (confirmed fallback, no API integration built yet), Creem (third option,
 * weaker trust signal but real, no API integration built yet).
 *
 * Shape: tier -> interval -> provider -> real price ID, or null if that
 * combo has no real price ID yet. Mirrors the cascade registry pattern
 * (web/lib/config/cascade.ts / supabase/migrations/20260725140000_cascade_registry.sql)
 * -- stored as a single json value under one registry key
 * (`billing.priceIds`), editable from the settings page without a redeploy.
 * Adding a new tier, provider, or interval is a registry-value edit, not a
 * code change; `resolvePriceIds()`/`resolvePriceId()` below are the only
 * places this should be read from -- never hardcode a price ID at a call
 * site (see checkout/route.ts's prior `resolvePriceId` for the pattern this
 * replaces).
 *
 * One deliberate exception, kept for backward compatibility: Pro/monthly
 * has historically been resolved from a top-level env var
 * (PADDLE_PRO_PRICE_ID / STRIPE_PRICE_ID_PRO) rather than a DB row, and that
 * env var may already point at whatever price Paddle/Stripe currently has
 * live for Pro/monthly in this environment. `resolvePriceId()` checks that
 * env var FIRST for exactly the (pro, month) combo, falling through to the
 * registry only if the env var is unset -- this preserves today's real
 * checkout path exactly, rather than silently swapping in a different price
 * ID out from under it.
 */

export type PriceTier = 'light' | 'pro' | 'max';
export type PriceInterval = 'month' | 'year';
/**
 * Provider identifiers the registry understands. Broader than
 * `BillingProviderType` (web/lib/types/billing.ts) on purpose -- `dodo` and
 * `creem` have no live `BillingProvider` implementation yet (no API keys,
 * no SDK wired into billing-factory.ts), but the registry structure is
 * ready for them the moment that integration work happens: add the
 * provider's real price IDs here and a `BillingProvider` implementation in
 * billing-factory.ts, no schema/migration change needed.
 */
export type PriceProviderId = 'paddle' | 'stripe' | 'dodo' | 'creem';

export type PriceIdRegistry = Record<PriceTier, Record<PriceInterval, Record<PriceProviderId, string | null>>>;

function emptyProviderMap(): Record<PriceProviderId, string | null> {
  return { paddle: null, stripe: null, dodo: null, creem: null };
}

/**
 * Fallback used ONLY if the registry itself is unreachable (DB down, etc.)
 * -- kept in sync with the migration's seeded default_value, never the live
 * source of truth. Paddle sandbox price IDs below are real objects created
 * 2026-08-18 via the Paddle sandbox MCP (products.create + prices.create),
 * not simulated -- see the migration file's header comment for the full
 * provenance note (candidate prices, sandbox environment, not final/locked).
 */
export const PRICE_IDS_FALLBACK: PriceIdRegistry = {
  light: {
    month: { ...emptyProviderMap(), paddle: 'pri_01m0azkzf40rxr0s09dacy1bqc' },
    year: { ...emptyProviderMap(), paddle: 'pri_01m0azkzqkrn72rkmrh7363a56' },
  },
  pro: {
    // month/paddle intentionally null here -- resolvePriceId() resolves
    // pro/month from PADDLE_PRO_PRICE_ID/STRIPE_PRICE_ID_PRO first (see
    // module doc comment); this registry row is the pro/year + everything-
    // else path.
    month: emptyProviderMap(),
    year: { ...emptyProviderMap(), paddle: 'pri_01m0azm06tqsbxxbm8nyqs2whq' },
  },
  max: {
    month: { ...emptyProviderMap(), paddle: 'pri_01m0azm0gxd599sca4acw17vkp' },
    year: { ...emptyProviderMap(), paddle: 'pri_01m0azm0np6qyp6zq8e51qdffk' },
  },
};

const REGISTRY_KEY = 'billing.priceIds';

export async function resolvePriceIds(): Promise<PriceIdRegistry> {
  const resolved = await SupabaseSettingsAdapter.getRegistrySettings(
    [REGISTRY_KEY],
    { [REGISTRY_KEY]: PRICE_IDS_FALLBACK as unknown }
  );
  const value = resolved[REGISTRY_KEY];
  return value && typeof value === 'object' ? (value as PriceIdRegistry) : PRICE_IDS_FALLBACK;
}

/**
 * Resolve a single (tier, interval, provider) combo to a real price ID, or
 * null if none exists yet -- callers MUST treat null as "unsupported combo,
 * fail closed (400)", never substitute a different tier/interval/provider's
 * price (see checkout/route.ts's prior Cubic P0 finding: silently
 * substituting Pro/monthly for whatever was actually requested).
 */
export async function resolvePriceId(
  tier: PriceTier,
  interval: PriceInterval,
  provider: PriceProviderId
): Promise<string | null> {
  // Backward-compat override, see module doc comment.
  if (tier === 'pro' && interval === 'month') {
    if (provider === 'paddle' && process.env.PADDLE_PRO_PRICE_ID) return process.env.PADDLE_PRO_PRICE_ID;
    if (provider === 'stripe' && process.env.STRIPE_PRICE_ID_PRO) return process.env.STRIPE_PRICE_ID_PRO;
  }
  const registry = await resolvePriceIds();
  return registry[tier]?.[interval]?.[provider] ?? null;
}
