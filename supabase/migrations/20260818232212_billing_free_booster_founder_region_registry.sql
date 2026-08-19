-- Expands the billing pricing registry (20260818174553_billing_price_ids_registry.sql)
-- with Free/founder tiers appended to billing.priceIds, plus two new registry
-- keys for booster packs and region routing. See web/lib/config/pricing.ts
-- for the resolvers (resolvePriceIds/resolveBoosterPriceIds/resolveRegionRouting)
-- -- that file is the single place these values should ever be read from.
--
-- Real Paddle SANDBOX products/prices created 2026-08-19 via the Paddle
-- sandbox MCP (products.create then prices.create), same provenance pattern
-- as the prior migration. NOT live/real money.
--
-- Free tier: real Paddle sandbox PRODUCT created (pro_01m0bjt0nvzdpfhkz8hr28def9)
-- with deliberately NO Price object -- Paddle checkout requires a positive
-- amount, and $0 tiers are conventionally modeled as a product with no
-- price (entitlement/quota tracked in our own DB), matching how Stripe
-- models a Free plan too. billing.priceIds.free.once stays all-null on
-- purpose.
--
-- Founder tiers: placeholder internal keys founder_tier_a/founder_tier_b
-- (real marketing display names pending a separate naming task, per
-- explicit task-dispatch instruction -- do not rename these keys without
-- also updating web/lib/config/pricing.ts's PriceTier union). Prices $49 /
-- $99 one-time per docs/private/2026-08-16_PRICING_ECONOMICS_MASTER_MODEL.md
-- §6q (explicitly instructed as decided, though the doc itself still frames
-- them as "illustrative... real research-backed number still needed" --
-- flagged, not resolved here).
--
-- Booster packs (billing.boosterPriceIds, NEW key): sizes 5/10/20/50/100 per
-- master doc §6t. IMPORTANT PROVENANCE FLAG: the master doc's own §6g/§6t
-- explicitly say pack PRICES were NOT finalized ("need the same
-- market-comparable exercise the Council should run, not a number invented
-- here") -- despite this task's dispatch framing that pricing was "already
-- researched." Seeded prices below ($4.99/$8.99/$15.99/$34.99/$59.99) are a
-- candidate sub-linear discount ladder anchored to the real comparables §6g
-- DOES cite (Monica credit packs, Gistilo topup, Happy Scribe overage), not
-- a Council-approved final number -- same "candidate, not final" status as
-- Max tier's placeholder price in pricing-plans.ts.
--
-- Region routing (billing.regionRouting, NEW key): region/country code ->
-- preferred provider, with a required `default` catch-all. Resolves to
-- 'paddle' for every region today (only real live integration) but the
-- shape is provider-agnostic and ready for Dodo/Creem the moment those are
-- wired in -- a registry-value edit, not a code change.

-- 1. Append free/founder tiers to the existing billing.priceIds default_value.
update public.setting_definitions
set default_value = default_value || '{
  "free": {
    "once": {"paddle": null, "stripe": null, "dodo": null, "creem": null}
  },
  "founder_tier_a": {
    "once": {"paddle": "pri_01m0bjt2sv9qkr4jyq1kpfjgmt", "stripe": null, "dodo": null, "creem": null}
  },
  "founder_tier_b": {
    "once": {"paddle": "pri_01m0bjt33qc1njber48kx9ewtx", "stripe": null, "dodo": null, "creem": null}
  }
}'::jsonb,
  description = description || ' Extended 2026-08-19 with free/founder_tier_a/founder_tier_b (interval "once" for one-time prices).'
where key = 'billing.priceIds';

update public.setting_values
set value = value || '{
  "free": {
    "once": {"paddle": null, "stripe": null, "dodo": null, "creem": null}
  },
  "founder_tier_a": {
    "once": {"paddle": "pri_01m0bjt2sv9qkr4jyq1kpfjgmt", "stripe": null, "dodo": null, "creem": null}
  },
  "founder_tier_b": {
    "once": {"paddle": "pri_01m0bjt33qc1njber48kx9ewtx", "stripe": null, "dodo": null, "creem": null}
  }
}'::jsonb
where setting_key = 'billing.priceIds';

-- 2. New key: billing.boosterPriceIds
insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'billing.boosterPriceIds',
    'system',
    'json',
    '{}'::jsonb,
    '{
      "5":   {"paddle": "pri_01m0bjt0zkyktq7cchfyngbd4e", "stripe": null, "dodo": null, "creem": null},
      "10":  {"paddle": "pri_01m0bjt19dr1fsvbt30by07b8c", "stripe": null, "dodo": null, "creem": null},
      "20":  {"paddle": "pri_01m0bjt1wzfn85tztbcy5f3rx8", "stripe": null, "dodo": null, "creem": null},
      "50":  {"paddle": "pri_01m0bjt26sgefp7awhfwg8x9ne", "stripe": null, "dodo": null, "creem": null},
      "100": {"paddle": "pri_01m0bjt2gf0r2kt4a7shrjde5k", "stripe": null, "dodo": null, "creem": null}
    }'::jsonb,
    'Booster pack (one-time credit top-up) price-ID registry: size -> provider -> real price ID. See web/lib/config/pricing.ts resolveBoosterPriceId(). PRICES ARE CANDIDATE, NOT COUNCIL-APPROVED -- see migration header / pricing.ts doc comment for the master pricing doc''s explicit "not finalized" caveat.',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key = 'billing.boosterPriceIds'
on conflict (setting_key, scope_type, scope_id) do nothing;

-- 3. New key: billing.regionRouting
insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'billing.regionRouting',
    'system',
    'json',
    '{}'::jsonb,
    '{
      "default": "paddle",
      "US": "paddle",
      "EU": "paddle",
      "IN": "paddle",
      "GB": "paddle"
    }'::jsonb,
    'Region/country-code -> preferred payment provider routing, with a required "default" catch-all. See web/lib/config/pricing.ts resolveProviderForRegion(). Resolves to paddle for every region today (only real live integration); structure is ready to route to dodo/creem per-region once those integrations exist, no code change needed.',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key = 'billing.regionRouting'
on conflict (setting_key, scope_type, scope_id) do nothing;
