// DRAFT / PLACEHOLDER — reflects the candidate tier structure in
// docs/private/2026-08-16_PRICING_ECONOMICS_MASTER_MODEL.md §2.
// Prices are the LOW end of each candidate range, not final locked prices.
// Do not ship to production until real pricing is decided.
//
// Single source of truth for plan name/price/description — imported by both
// the full pricing table (components/billing/pricing-table-client.tsx) and
// the landing page's pricing summary (app/landing-page.tsx) so the two
// surfaces can never drift out of sync again.
// Amounts now derived from PRICING_REGISTRY_FALLBACK (SSOT) — no hardcoded
// literals bypassing the registry.

export interface PricingPlan {
  name: string;
  /** Lowercase checkout identifier -- must match a key `resolvePriceId` in
   *  web/app/api/billing/checkout/route.ts understands. */
  checkoutPlan: 'light' | 'pro' | 'max';
  monthlyPrice: number | null; // null = "contact us"
  desc: string;
  features: { label: string; tooltip: string }[];
  recommended: boolean;
}

/**
 * Whether the numbers in PRICING_PLANS below are real, approved, purchasable
 * pricing -- or still a candidate/draft range awaiting sign-off.
 *
 * Real fix for Cubic P0 finding (2026-08-18): candidate prices were publicly
 * rendered AND purchasable (a user could buy a "candidate, not final" price
 * for real money). While this stays `false`, the pricing table renders every
 * paid tier's CTA as a non-transactable "Coming soon" preview instead of a
 * working checkout button -- flip to `true` only once real pricing is locked
 * (see docs/private/2026-08-16_PRICING_ECONOMICS_MASTER_MODEL.md) AND real
 * provider price IDs exist for every tier this flag would unlock.
 */
export const PRICING_APPROVED = false;

import { PRICING_REGISTRY_FALLBACK } from '@/lib/config/pricing-settings';

export const PRICING_PLANS: PricingPlan[] = [
  {
    name: "Free",
    checkoutPlan: "light",
    monthlyPrice: PRICING_REGISTRY_FALLBACK.free.amountCents !== null ? PRICING_REGISTRY_FALLBACK.free.amountCents / 100 : 0,
    desc: "Try a full analysis, no card required",
    features: [
      { label: "Limited analyses/month (paced, resets monthly)", tooltip: "A small monthly allowance that resets automatically — no card required to try it." },
      { label: "Executive Digest + Apex Intelligence", tooltip: "A concise, high-level summary of a video's key claims and takeaways — same content as Light, just fewer analyses per month." },
      { label: "WordCloud", tooltip: "A visual map of the key terms and topics extracted from the video." },
      { label: "Standard 48–72hr processing", tooltip: "Typical time from submitting a video to a completed analysis." },
    ],
    recommended: false,
  },
  {
    name: "Light",
    checkoutPlan: "light",
    monthlyPrice: PRICING_REGISTRY_FALLBACK.light.amountCents !== null ? PRICING_REGISTRY_FALLBACK.light.amountCents / 100 : 5,
    desc: "A focused view of every analysis",
    features: [
      { label: "15 analyses/mo & 5 hrs of video (whichever hits first)", tooltip: "Your monthly quota, capped by whichever limit — analysis count or total video hours — you hit first." },
      { label: "Executive Digest + Apex Intelligence", tooltip: "A concise, high-level summary of a video's key claims and takeaways." },
      { label: "MindMap + Knowledge Graph Canvas", tooltip: "Interactive visual maps of entities and relationships extracted from the video, beyond the WordCloud." },
      { label: "Not included: full 11-dimension breakdown", tooltip: "The deep, per-dimension analysis (framing, tactics, claims, etc.) is a Pro/Max feature." },
    ],
    recommended: false,
  },
  {
    name: "Pro",
    checkoutPlan: "pro",
    monthlyPrice: PRICING_REGISTRY_FALLBACK.pro.amountCents !== null ? PRICING_REGISTRY_FALLBACK.pro.amountCents / 100 : 9,
    desc: "The complete intelligence breakdown",
    features: [
      { label: "60 analyses/mo & 20 hrs of video (whichever hits first)", tooltip: "Your monthly quota, capped by whichever limit — analysis count or total video hours — you hit first." },
      { label: "Full 11-dimension UCIS breakdown", tooltip: "The complete synthesis across all 11 analysis dimensions, not just the Executive Digest." },
      { label: "Everything in Light, unabridged", tooltip: "Includes the full Knowledge Graph and Executive Digest with no scope reduction." },
      { label: "Standard processing", tooltip: "Typical time from submitting a video to a completed analysis." },
    ],
    recommended: true,
  },
  {
    name: "Max",
    checkoutPlan: "max",
    monthlyPrice: null,
    desc: "For high-volume research",
    features: [
      { label: "~120–150 analyses/mo & ~40 hrs of video", tooltip: "A larger monthly quota for teams or heavy research use — exact volume confirmed at signup." },
      { label: "Everything in Pro, at double the quota", tooltip: "Same full 11-dimension breakdown and Knowledge Graph as Pro, at roughly double the monthly volume." },
      { label: "Priority processing (candidate)", tooltip: "Faster turnaround than standard processing — under evaluation, not yet locked in." },
    ],
    recommended: false,
  },
];
