import { AUTH_CONFIG } from './config';
import { NextAuthProvider } from './providers/nextauth';
import { VercelAuthProvider } from './providers/vercel';
import { SupabaseAuthProvider } from './providers/supabase';
import { AuthProvider } from './types';

const getAuthProvider = (): AuthProvider => {
  const providerType = AUTH_CONFIG.provider;

  switch (providerType) {
    case 'supabase':
      return new SupabaseAuthProvider();
    case 'vercel':
      return new VercelAuthProvider();
    case 'nextauth':
    default:
      return new NextAuthProvider();
  }
};

export const authProvider = getAuthProvider();
