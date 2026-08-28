export type PricingTierKey = 'free' | 'light' | 'pro' | 'max' | 'founder' | 'founder_tier_a' | 'founder_tier_b' | 'enterprise';

export interface PricingTierConfig {
  amountCents: number | null;
  currency: string;
  interval: 'month' | 'year' | 'once' | null;
  display: string;
  label: string;
}

export const PRICING_REGISTRY_FALLBACK: Record<PricingTierKey, PricingTierConfig> = {
  free: { amountCents: 0, currency: 'USD', interval: null, display: '$0', label: 'Free' },
  light: { amountCents: 500, currency: 'USD', interval: 'month', display: '$5', label: 'Light' },
  pro: { amountCents: 900, currency: 'USD', interval: 'month', display: '$9', label: 'Pro' },
  max: { amountCents: null, currency: 'USD', interval: 'month', display: 'Contact us', label: 'Max' },
  founder: { amountCents: 2900, currency: 'USD', interval: 'once', display: '$29', label: 'Founder' },
  founder_tier_a: { amountCents: 4900, currency: 'USD', interval: 'once', display: '$49', label: 'Founder Light' },
  founder_tier_b: { amountCents: 9900, currency: 'USD', interval: 'once', display: '$99', label: 'Founder Pro' },
  enterprise: { amountCents: null, currency: 'USD', interval: 'month', display: 'Contact us', label: 'Enterprise' },
};

export function formatPriceDisplay(tier: PricingTierKey): string {
  return PRICING_REGISTRY_FALLBACK[tier]?.display ?? '';
}

export function getPricingConfig(tier: PricingTierKey): PricingTierConfig | null {
  return PRICING_REGISTRY_FALLBACK[tier] ?? null;
}
