/**
 * Pairwise Test Configuration
 * Centralized setup for all 38 test cases with environment, mocks, and helpers
 */

import { testUsers } from './fixtures/users';
import { testVideos, cachedAnalyses, redisCacheEntries } from './fixtures/videos';
import { openrouterMocks, upstashMocks, stripeMocks, networkErrors } from './mocks/services';

/**
 * Test environment configuration
 */
export const testEnvironments = {
  production: {
    NODE_ENV: 'production',
    NEXT_PUBLIC_VERCEL_ENV: 'production',
    isCI: false,
    isDev: false,
    isProd: true,
  },

  ci: {
    NODE_ENV: 'production', // CI builds as production
    GITHUB_ACTIONS: 'true',
    CI: 'true',
    isCI: true,
    isDev: false,
    isProd: false,
  },

  development: {
    NODE_ENV: 'development',
    isCI: false,
    isDev: true,
    isProd: false,
  },
} as const;

/**
 * Auth provider configurations
 */
export const authConfigs = {
  supabase: {
    provider: 'supabase' as const,
    AUTH_PROVIDER: 'supabase',
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'mock-anon-key',
  },

  nextauth: {
    provider: 'nextauth' as const,
    AUTH_PROVIDER: 'nextauth',
    NEXTAUTH_SECRET: 'test-secret-32-characters-long-min',
    NEXTAUTH_URL: 'http://localhost:3000',
  },
} as const;

/**
 * Rate limit tier configurations
 */
export const rateTierConfigs = {
  free: {
    tier: 'free' as const,
    analysesPerMonth: 3,
    exportsPerMonth: 1,
    sharesPerMonth: 30,
    priority: 'normal' as const,
  },

  pro: {
    tier: 'pro' as const,
    analysesPerMonth: 999, // Effectively unlimited
    exportsPerMonth: 10,
    sharesPerMonth: 999,
    priority: 'high' as const,
  },

  enterprise: {
    tier: 'enterprise' as const,
    analysesPerMonth: 9999, // Effectively unlimited
    exportsPerMonth: 9999,
    sharesPerMonth: 9999,
    priority: 'critical' as const,
  },
} as const;

/**
 * Error scenarios
 */
export const errorScenarios = {
  none: {
    type: 'success' as const,
    shouldFail: false,
  },

  networkFail: {
    type: 'network_timeout' as const,
    shouldFail: false, // May fallback to cache
    mockError: networkErrors.serviceUnavailable,
  },

  missingData: {
    type: 'missing_data' as const,
    shouldFail: true,
    statusCode: 400,
    errorCode: 'INVALID_INPUT',
  },

  invalidInput: {
    type: 'invalid_input' as const,
    shouldFail: true,
    statusCode: 400,
    errorCode: 'VALIDATION_ERROR',
  },
} as const;

/**
 * Cache state configurations
 */
export const cacheStates = {
  fresh: {
    state: 'fresh' as const,
    ageSeconds: 30, // < 5 minutes
    ttlRemaining: 3570, // ~1 hour
    shouldHit: true,
  },

  stale: {
    state: 'stale' as const,
    ageSeconds: 5400, // 90 minutes (past TTL)
    ttlRemaining: 0,
    shouldHit: false, // Technically expired, but might use stale-while-revalidate
  },

  expired: {
    state: 'expired' as const,
    ageSeconds: 7200, // 2 hours (well past TTL)
    ttlRemaining: -1,
    shouldHit: false,
  },
} as const;

/**
 * API endpoint configurations
 */
export const apiEndpoints = {
  analyses: {
    path: '/api/analyses',
    method: 'POST' as const,
    requiresAuth: true,
    rateLimit: 'analyses',
    description: 'Create analysis from YouTube URL',
  },

  search: {
    path: '/api/analyses/search',
    method: 'POST' as const,
    requiresAuth: true,
    rateLimit: 'analyses',
    description: 'Semantic search across analyses',
  },

  metadata: {
    path: '/api/metadata',
    method: 'GET' as const,
    requiresAuth: false,
    rateLimit: null,
    description: 'Get public video metadata',
  },

  export: {
    path: '/api/analyses/export',
    method: 'POST' as const,
    requiresAuth: true,
    rateLimit: 'exports',
    description: 'Export analysis as PDF',
  },

  share: {
    path: '/api/analyses/share',
    method: 'POST' as const,
    requiresAuth: true,
    rateLimit: 'shares',
    description: 'Generate shareable link',
  },
} as const;

/**
 * Middleware path classifications
 */
export const middlewarePaths = {
  public: {
    type: 'public' as const,
    requiresAuth: false,
    routes: ['/api/auth', '/api/health', '/api/metadata'],
    description: 'Public endpoints, no authentication',
  },

  protected: {
    type: 'protected' as const,
    requiresAuth: true,
    routes: ['/api/analyses', '/api/analyses/search', '/api/analyses/export', '/api/analyses/share'],
    description: 'Authenticated user access required',
  },

  admin: {
    type: 'admin' as const,
    requiresAuth: true,
    requiresRole: 'admin',
    routes: ['/api/admin/stats'],
    description: 'Admin-only endpoints',
  },
} as const;

/**
 * Test case mapping (from pairwise matrix)
 */
export const testCases = {
  PW1_001: {
    id: 'PW1-001',
    environment: 'production',
    auth: 'supabase',
    tier: 'free',
    error: 'none',
    cache: 'fresh',
    endpoint: 'analyses',
    middleware: 'protected',
    description: 'Production + Supabase + Free Tier + Clean + Fresh Cache',
  },

  PW1_002: {
    id: 'PW1-002',
    environment: 'production',
    auth: 'supabase',
    tier: 'pro',
    error: 'networkFail',
    cache: 'stale',
    endpoint: 'search',
    middleware: 'public',
    description: 'Network failure with stale cache fallback',
  },

  PW1_006: {
    id: 'PW1-006',
    environment: 'ci',
    auth: 'supabase',
    tier: 'free',
    error: 'networkFail',
    cache: 'fresh',
    endpoint: 'analyses',
    middleware: 'public',
    description: 'CI environment with polyfill and rate limit check',
  },

  // ... Additional test cases can be generated programmatically
} as const;

/**
 * Helper to get test configuration by case ID
 */
export function getTestConfig(caseId: string) {
  const [env, auth, tier, error, cache, endpoint, middleware] = caseId
    .toUpperCase()
    .replace('PW1-', '')
    .split('_');

  const envMap: Record<string, keyof typeof testEnvironments> = {
    '001': 'production',
    '002': 'production',
    '003': 'production',
    '004': 'development',
    '005': 'development',
    '006': 'ci',
  } as any;

  const envKey = envMap[caseId.replace('PW1-', '')];
  return {
    environment: testEnvironments[envKey || 'development'],
    caseId,
  };
}

/**
 * Helper to create test request with proper headers and auth
 */
export function createTestRequest(
  caseId: string,
  endpoint: string,
  body?: unknown,
  userId: string = testUsers.freeUser.id
) {
  const url = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}${endpoint}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'PairwiseTestSuite/1.0',
  };

  // Add auth header for protected routes
  if (endpoint.includes('/api/analyses') || endpoint.includes('/api/admin')) {
    headers['Authorization'] = `Bearer test-token-${userId}`;
  }

  return {
    method: endpoint.includes('POST') ? 'POST' : 'GET',
    url,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  };
}

/**
 * Helper to validate response structure
 */
export function validateResponse(
  response: Response,
  expectedStatus: number,
  expectedContent?: string
) {
  const isSuccess = response.status === expectedStatus;
  const hasContent = expectedContent ? response.body?.toString().includes(expectedContent) : true;

  return {
    passed: isSuccess && hasContent,
    status: response.status,
    expectedStatus,
    hasContent,
  };
}

/**
 * Test fixtures registry
 */
export const fixtures = {
  users: testUsers,
  videos: testVideos,
  analyses: cachedAnalyses,
  cache: redisCacheEntries,
  mocks: {
    openrouter: openrouterMocks,
    upstash: upstashMocks,
    stripe: stripeMocks,
    network: networkErrors,
  },
};
