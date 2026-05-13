import { AuthProvider } from './types';
import { NextAuthProvider } from './providers/nextauth';
import { SupabaseAuthProvider } from './providers/supabase';
import { VercelAuthProvider } from './providers/vercel';
import { AUTH_CONFIG } from './config';

function getAuthProvider(): AuthProvider {
  switch (AUTH_CONFIG.provider) {
    case 'vercel':
      return new VercelAuthProvider(AUTH_CONFIG.providers.vercel);
    case 'supabase':
      return new SupabaseAuthProvider(AUTH_CONFIG.providers.supabase);
    case 'nextauth':
      return new NextAuthProvider();
    default:
      throw new Error(`Unknown auth provider: ${AUTH_CONFIG.provider}`);
  }
}

export const authProvider = getAuthProvider();
