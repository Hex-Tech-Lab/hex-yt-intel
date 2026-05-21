/**
 * Test User Fixtures
 * Predefined user profiles for pairwise test execution
 * Includes free/pro/enterprise tiers + admin role
 */

export const testUsers = {
  // Free tier user (default)
  freeUser: {
    id: 'user-free-001',
    email: 'free@example.com',
    tier: 'free' as const,
    role: 'user' as const,
    analyses_used: 0,
    last_reset_date: new Date().toISOString(),
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
  },

  // Free tier user at quota boundary (2/3 used)
  freeUserNearQuota: {
    id: 'user-free-002',
    email: 'free-quota@example.com',
    tier: 'free' as const,
    role: 'user' as const,
    analyses_used: 2,
    last_reset_date: new Date().toISOString(),
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  },

  // Free tier user at quota exceeded (would fail on insert)
  freeUserOverQuota: {
    id: 'user-free-003',
    email: 'free-exceeded@example.com',
    tier: 'free' as const,
    role: 'user' as const,
    analyses_used: 3,
    last_reset_date: new Date().toISOString(),
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  },

  // Pro tier user (unlimited analyses)
  proUser: {
    id: 'user-pro-001',
    email: 'pro@example.com',
    tier: 'pro' as const,
    role: 'user' as const,
    analyses_used: 0,
    last_reset_date: new Date().toISOString(),
    created_at: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year ago
  },

  // Enterprise tier user (premium features)
  enterpriseUser: {
    id: 'user-enterprise-001',
    email: 'enterprise@example.com',
    tier: 'enterprise' as const,
    role: 'user' as const,
    analyses_used: 0,
    last_reset_date: new Date().toISOString(),
    created_at: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
  },

  // Admin user (access to /api/admin routes)
  adminUser: {
    id: 'user-admin-001',
    email: 'admin@example.com',
    tier: 'enterprise' as const,
    role: 'admin' as const,
    analyses_used: 0,
    last_reset_date: new Date().toISOString(),
    created_at: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
  },

  // Test user for CI bypass (persistent UUID)
  ciTestUser: {
    id: 'da4381c6-f774-4c99-8f04-2c1c9e27d1fb',
    email: 'kellybakri@gmail.com',
    tier: 'free' as const,
    role: 'user' as const,
    analyses_used: 0,
    last_reset_date: new Date().toISOString(),
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  },
} as const;

/**
 * NextAuth session fixture
 * Valid JWT token structure for NextAuth.js authentication
 */
export const nextAuthSession = (userId: string = testUsers.freeUser.id) => ({
  user: {
    id: userId,
    email: testUsers.freeUser.email,
    name: 'Test User',
    image: 'https://avatars.example.com/user.jpg',
  },
  expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
});

/**
 * Supabase session fixture
 * Valid Supabase auth session with access token
 */
export const supabaseSession = (userId: string = testUsers.freeUser.id) => ({
  access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
  user: {
    id: userId,
    email: testUsers.freeUser.email,
    user_metadata: {
      avatar_url: 'https://avatars.example.com/user.jpg',
    },
  },
  expires_at: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours from now in Unix timestamp
});

/**
 * Expired Supabase session
 * For testing fallback cache behavior
 */
export const expiredSupabaseSession = (userId: string = testUsers.freeUser.id) => ({
  access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
  user: {
    id: userId,
    email: testUsers.freeUser.email,
    user_metadata: {
      avatar_url: 'https://avatars.example.com/user.jpg',
    },
  },
  expires_at: Math.floor(Date.now() / 1000) - 60 * 60, // Expired 1 hour ago
});

/**
 * Authorization headers for testing
 */
export const authHeaders = {
  supabase: (token: string = supabaseSession().access_token) => ({
    Authorization: `Bearer ${token}`,
  }),

  nextauth: (sessionId: string = 'test-session-123') => ({
    Cookie: `next-auth.session-token=${sessionId}`,
  }),

  devBypass: (token: string = 'dev-bypass-token-123') => ({
    'X-Hex-Test-Secret': token,
  }),
};

/**
 * Helper to create custom user profile
 */
export function createTestUser(overrides: Partial<typeof testUsers.freeUser> = {}) {
  return {
    ...testUsers.freeUser,
    ...overrides,
  };
}
