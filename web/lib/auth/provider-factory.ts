/**
 * Auth Provider Factory
 * Returns the appropriate auth provider based on AUTH_PROVIDER environment variable
 */

import { AUTH_CONFIG } from './config';
import type { Session } from 'next-auth';

export interface AuthSession {
  user: {
    id: string;
    email: string;
    name?: string;
    image?: string;
  };
}

/**
 * Get current user session using the active auth provider
 */
export async function getAuthSession(): Promise<AuthSession | null> {
  const provider = AUTH_CONFIG.provider;

  if (provider === 'supabase') {
    const { getSupabaseSession } = await import('./providers/supabase');
    const session = await getSupabaseSession();
    if (session?.user) {
      return {
        user: {
          id: session.user.id,
          email: session.user.email || '',
          name: session.user.user_metadata?.name || session.user.user_metadata?.full_name,
          image: session.user.user_metadata?.avatar_url,
        },
      };
    }
    return null;
  }

  if (provider === 'nextauth') {
    const { getServerSession } = await import('next-auth');
    const { authConfig } = await import('./nextauth-config');
    const session = (await getServerSession(authConfig)) as Session | null;
    if (session?.user) {
      return {
        user: {
          id: (session.user as any).id || '',
          email: session.user.email || '',
          name: session.user.name || undefined,
          image: session.user.image || undefined,
        },
      };
    }
    return null;
  }

  return null;
}

/**
 * Sign out using the active auth provider
 */
export async function signOut() {
  const provider = AUTH_CONFIG.provider;

  if (provider === 'supabase') {
    const { signOutSupabase } = await import('./providers/supabase');
    await signOutSupabase();
  } else if (provider === 'nextauth') {
    const { signOut: nextAuthSignOut } = await import('next-auth/react');
    await nextAuthSignOut();
  }
}
