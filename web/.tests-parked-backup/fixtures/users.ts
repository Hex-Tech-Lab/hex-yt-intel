/**
 * Test User Fixtures
 * User profiles for pairwise testing with auth sessions
 */

export const testUsers = {
  freeUser: {
    id: 'user-free-001',
    email: 'free@example.com',
    tier: 'free',
    analysesUsed: 0,
  },

  freeUserNearQuota: {
    id: 'user-free-002',
    email: 'free-near@example.com',
    tier: 'free',
    analysesUsed: 2,
  },

  freeUserOverQuota: {
    id: 'user-free-003',
    email: 'free-over@example.com',
    tier: 'free',
    analysesUsed: 3,
  },

  proUser: {
    id: 'user-pro-001',
    email: 'pro@example.com',
    tier: 'pro',
    analysesUsed: 50,
  },

  enterpriseUser: {
    id: 'user-enterprise-001',
    email: 'enterprise@example.com',
    tier: 'enterprise',
    analysesUsed: 500,
  },

  adminUser: {
    id: 'user-admin-001',
    email: 'admin@example.com',
    tier: 'enterprise',
    role: 'admin',
    analysesUsed: 0,
  },

  ciTestUser: {
    id: 'da4381c6-f774-4c99-8f04-2c1c9e27d1fb',
    email: 'kellybakri@gmail.com',
    tier: 'free',
    analysesUsed: 0,
  },
};

/**
 * Supabase session templates
 */
export function supabaseSession(userId: string) {
  return {
    user: {
      id: userId,
      email: testUsers.freeUser.email,
      user_metadata: {},
    },
    session: {
      access_token: `token-${userId}`,
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    },
  };
}

export function expiredSupabaseSession(userId: string) {
  return {
    user: {
      id: userId,
      email: testUsers.freeUser.email,
    },
    session: {
      access_token: `token-${userId}`,
      expires_in: 0,
      expires_at: Math.floor(Date.now() / 1000) - 1,
    },
  };
}

/**
 * NextAuth session template
 */
export function nextAuthSession(userId: string) {
  return {
    user: {
      id: userId,
      email: testUsers.freeUser.email,
      name: 'Test User',
    },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
  };
}

/**
 * Authorization headers for different auth methods
 */
export const authHeaders = {
  supabase: (token: string) => ({
    Authorization: `Bearer ${token}`,
  }),

  nextauth: (sessionId: string) => ({
    Cookie: `next-auth.session-token=${sessionId}`,
  }),

  devBypass: (token: string) => ({
    'X-Hex-Test-Secret': token,
  }),
};

/**
 * Helper to create custom user fixture
 */
export function createTestUser(overrides: Partial<typeof testUsers.freeUser> = {}) {
  return {
    ...testUsers.freeUser,
    ...overrides,
  };
}
