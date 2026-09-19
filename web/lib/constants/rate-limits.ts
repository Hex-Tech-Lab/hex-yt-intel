import type { UserTier } from '@/lib/types/billing';

/**
 * Per-minute sliding-window rate limits keyed by the canonical UserTier.
 * Light temporarily shares Pro's limits and Max shares Enterprise's --
 * real per-tier numbers are a NEEDS USER DECISION (no empirical data yet;
 * standing no-hardcoded-magic-numbers rule). Typed Record<UserTier, ...> so
 * adding a tier to UserTier forces a deliberate entry here instead of the
 * silent `|| 3` free fallback at the call sites.
 */
export const RATE_LIMITS: Record<UserTier, {
  requestsPerMinute: number;
  requestsPerHour: number;
  description: string;
}> = {
  free: {
    requestsPerMinute: 3,
    requestsPerHour: 50,
    description: 'Free tier: 3 requests/minute, 50/hour',
  },
  light: {
    requestsPerMinute: 30,
    requestsPerHour: 500,
    description: 'Light tier: 30 requests/minute, 500/hour (pro interim values)',
  },
  pro: {
    requestsPerMinute: 30,
    requestsPerHour: 500,
    description: 'Pro tier: 30 requests/minute, 500/hour',
  },
  max: {
    requestsPerMinute: 300,
    requestsPerHour: 10000,
    description: 'Max tier: 300 requests/minute, 10000/hour (enterprise interim values)',
  },
  enterprise: {
    requestsPerMinute: 300,
    requestsPerHour: 10000,
    description: 'Enterprise tier: unlimited (300 req/min soft limit)',
  },
};

export type Tier = UserTier;
export type Endpoint = 'analyses' | 'search' | 'checkout';
