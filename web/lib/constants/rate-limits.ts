export const RATE_LIMITS = {
  free: {
    requestsPerMinute: 3,
    requestsPerHour: 50,
    description: 'Free tier: 3 requests/minute, 50/hour',
  },
  pro: {
    requestsPerMinute: 30,
    requestsPerHour: 500,
    description: 'Pro tier: 30 requests/minute, 500/hour',
  },
  enterprise: {
    requestsPerMinute: 300,
    requestsPerHour: 10000,
    description: 'Enterprise tier: unlimited (300 req/min soft limit)',
  },
} as const;

export type Tier = keyof typeof RATE_LIMITS;
export type Endpoint = 'analyses' | 'search' | 'checkout';
