import * as Sentry from '@sentry/nextjs';
import { getSupabaseClientWithAuth } from '@/lib/supabase';

export interface AuthSession {
  user: {
    id: string;
    email: string;
    name?: string;
    image?: string;
  };
}

export async function getAuthSession(): Promise<AuthSession | null> {
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();
  
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

export async function signOut(): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await getSupabaseClientWithAuth();
    await supabase.auth.signOut();
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[signOut] failed', { errorMessage });
    Sentry.captureException(error, { tags: { operation: 'sign-out' }, contexts: { auth: { operation: 'sign-out' } } });
    return { success: false, error: errorMessage };
  }
}
