// DRAFT / PLACEHOLDER — reflects the candidate tier structure in
// docs/private/2026-08-16_PRICING_ECONOMICS_MASTER_MODEL.md §2.
// Prices are the LOW end of each candidate range, not final locked prices.
// Do not ship to production until real pricing is decided.
//
// Single source of truth for plan name/price/description — imported by both
// the full pricing table (components/billing/pricing-table-client.tsx) and
// the landing page's pricing summary (app/landing-page.tsx) so the two
// surfaces can never drift out of sync again.

export interface PricingPlan {
  name: string;
  monthlyPrice: number | null; // null = "contact us"
  desc: string;
  features: { label: string; tooltip: string }[];
  recommended: boolean;
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    name: "Free",
    monthlyPrice: 0,
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
    monthlyPrice: 5,
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
    monthlyPrice: 9,
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
