-- Settings-Registry-based multi-provider price-ID structure (2026-08-18),
-- mirroring the cascade registry pattern (20260725140000_cascade_registry.sql):
-- one json value per registry key, tunable from the settings page without a
-- redeploy. See web/lib/config/pricing.ts for the resolver
-- (resolvePriceIds/resolvePriceId) -- that file is the single place this
-- value should ever be read from.
--
-- Shape: { [tier]: { [interval]: { [provider]: priceId | null } } }
-- tier: 'light' | 'pro' | 'max'   interval: 'month' | 'year'
-- provider: 'paddle' | 'stripe' | 'dodo' | 'creem'
--
-- Real MoR shortlist researched 2026-08-17/18: Paddle (primary; sandbox-only
-- today -- the account is not KYC-verified yet, not a caution/hold-back
-- decision, just what's actually available to transact against right now),
-- Dodo Payments (confirmed fallback), Creem (third option, weaker trust
-- signal but real). Only Paddle has real API keys in this project's env
-- (.env.local's PADDLE_API_KEY/PADDLE_ENVIRONMENT=sandbox) -- Dodo and Creem
-- have NO integration built (no SDK, no BillingProvider implementation in
-- web/lib/billing-factory.ts, no API keys anywhere in this repo). Their rows
-- below are seeded all-null on purpose: real infrastructure prep for a
-- provider that doesn't exist in code yet, not simulated data. Before either
-- can carry a real price ID, real account setup is needed first:
--   - Dodo Payments: create a Dodo merchant account, complete KYC, get API
--     keys (test + live), build a DodoProvider implementing BillingProvider
--     (web/lib/types/billing.ts) alongside PaddleProvider/StripeProvider in
--     billing-factory.ts, create real Dodo products/prices for each tier.
--   - Creem: same shape -- merchant account + KYC, API keys, a
--     CreemProvider implementation, real Creem products/prices per tier.
-- Once either exists, populate this registry's `dodo`/`creem` fields with
-- the real price IDs -- no code change needed beyond the new
-- BillingProvider implementation and wiring it into getBillingProvider().
--
-- Paddle price IDs seeded below are REAL sandbox objects (not simulated),
-- created 2026-08-18 via the Paddle sandbox MCP (products.create then
-- prices.create per tier/interval) using the candidate prices from
-- web/lib/constants/pricing-plans.ts (Light $5/mo, Pro $9/mo; Max has no
-- locked candidate price yet -- $19/mo used as a placeholder, roughly
-- "double Pro" per docs/private/2026-08-16_PRICING_ECONOMICS_MASTER_MODEL.md
-- §"Max" -- NOT a final/approved price, see pricing-plans.ts's
-- PRICING_APPROVED gate). Yearly prices use a 10x-monthly convention
-- (~2 months free), also a placeholder pending real pricing sign-off.
-- Sandbox price IDs are not secrets (no real money moves through them) so
-- they're committed here in plaintext, unlike the live PADDLE_PRO_PRICE_ID
-- env var this migration deliberately does NOT touch (see
-- web/lib/config/pricing.ts's resolvePriceId() for why pro/month keeps
-- resolving from the env var instead of this table).
--
-- pro/month/paddle is left null here on purpose: resolvePriceId() checks
-- PADDLE_PRO_PRICE_ID/STRIPE_PRICE_ID_PRO first for that one (tier,
-- interval) combo and only falls through to this registry if the env var is
-- unset, so today's real live/sandbox Pro-monthly checkout path is
-- unchanged by this migration.

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'billing.priceIds',
    'system',
    'json',
    '{}'::jsonb,
    '{
      "light": {
        "month": {"paddle": "pri_01m0azkzf40rxr0s09dacy1bqc", "stripe": null, "dodo": null, "creem": null},
        "year":  {"paddle": "pri_01m0azkzqkrn72rkmrh7363a56", "stripe": null, "dodo": null, "creem": null}
      },
      "pro": {
        "month": {"paddle": null, "stripe": null, "dodo": null, "creem": null},
        "year":  {"paddle": "pri_01m0azm06tqsbxxbm8nyqs2whq", "stripe": null, "dodo": null, "creem": null}
      },
      "max": {
        "month": {"paddle": "pri_01m0azm0gxd599sca4acw17vkp", "stripe": null, "dodo": null, "creem": null},
        "year":  {"paddle": "pri_01m0azm0np6qyp6zq8e51qdffk", "stripe": null, "dodo": null, "creem": null}
      }
    }'::jsonb,
    'Multi-provider price-ID registry: tier -> interval -> provider -> real price ID (or null if not yet configured). See web/lib/config/pricing.ts for the resolver. pro/month/paddle stays null here by design -- resolved from PADDLE_PRO_PRICE_ID env var instead, see that file''s doc comment.',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key = 'billing.priceIds'
on conflict (setting_key, scope_type, scope_id) do nothing;
