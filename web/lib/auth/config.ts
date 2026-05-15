/**
 * Centralized auth configuration
 * Supports multiple auth providers via AUTH_PROVIDER environment variable
 */

export const AUTH_CONFIG = {
  // Active provider: 'supabase' | 'nextauth'
  provider: (process.env.AUTH_PROVIDER || 'supabase') as 'supabase' | 'nextauth',

  supabase: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },

  nextauth: {
    secret: process.env.AUTH_SECRET || '',
  },

  google: {
    clientId: process.env.AUTH_GOOGLE_ID || '',
    clientSecret: process.env.AUTH_GOOGLE_SECRET || '',
  },

  providers: {
    supabase: {
      enabled: process.env.AUTH_PROVIDER !== 'nextauth',
    },
    nextauth: {
      enabled: process.env.AUTH_PROVIDER === 'nextauth',
    },
  },
};
