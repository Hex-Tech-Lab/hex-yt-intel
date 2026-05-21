/**
 * Centralized auth configuration
 * Supports multiple auth providers via AUTH_PROVIDER environment variable
 */

import { validateAuthConfig } from './env-validator';

// Validate at runtime (not during Vercel build)
if (typeof window === 'undefined' && !process.env.VERCEL) {
  validateAuthConfig();
}

export const AUTH_CONFIG = {
  provider: (process.env.AUTH_PROVIDER || 'supabase') as 'supabase' | 'nextauth',

  supabase: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },

  nextauth: {
    secret: process.env.NEXTAUTH_SECRET || '',
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  },
} as const;
