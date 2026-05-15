import { AUTH_CONFIG } from './config';
import { getSupabaseUser } from './providers/supabase';
import { getServerSession } from 'next-auth';
import { authConfig } from './nextauth-config';
import type { Session } from 'next-auth';

export interface AuthSession {
  user: {
    id: string;
    email: string;
    name?: string;
    image?: string;
  };
}

export async function getAuthSession(): Promise<AuthSession | null> {
  const provider = AUTH_CONFIG.provider;

  if (provider === 'supabase') {
    const user = await getSupabaseUser();
    if (user) {
      return {
        user: {
          id: user.id,
          email: user.email || '',
          name: user.user_metadata?.name || user.user_metadata?.full_name,
          image: user.user_metadata?.avatar_url,
        },
      };
    }
    return null;
  }

  if (provider === 'nextauth') {
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

export async function signOut(): Promise<void> {
  const provider = AUTH_CONFIG.provider;

  if (provider === 'supabase') {
    const { signOutSupabase } = await import('./providers/supabase');
    await signOutSupabase();
  } else if (provider === 'nextauth') {
    const { signOut: nextAuthSignOut } = await import('next-auth/react');
    await nextAuthSignOut();
  }
}
