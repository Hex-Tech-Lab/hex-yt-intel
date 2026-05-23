/**
 * Centralized auth configuration
 * Supports native Supabase authentication
 */

import { validateAuthConfig } from './env-validator';

// Validate only in production Vercel deployments
const isProduction = process.env.NEXT_PUBLIC_VERCEL_ENV === 'production';
if (typeof window === 'undefined' && isProduction) {
  validateAuthConfig();
}

export const AUTH_CONFIG = {
  provider: 'supabase' as const,

  supabase: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  },
} as const;
