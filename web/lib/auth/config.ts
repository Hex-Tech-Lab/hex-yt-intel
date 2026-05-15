/**
 * Centralized auth configuration
 * Supports multiple auth providers via AUTH_PROVIDER environment variable
 */

import { validateAuthConfig } from './env-validator';

// Validate only at runtime, not during build
// Skip validation in build environments (Vercel sets VERCEL=true during builds)
if (!process.env.VERCEL) {
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
    secret: process.env.AUTH_SECRET || '',
  },

  google: {
    clientId: process.env.AUTH_GOOGLE_ID || '',
    clientSecret: process.env.AUTH_GOOGLE_SECRET || '',
  },
} as const;
