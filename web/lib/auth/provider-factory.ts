import { getSupabaseUser } from './providers/supabase';

export interface AuthSession {
  user: {
    id: string;
    email: string;
    name?: string;
    image?: string;
  };
}

export async function getAuthSession(): Promise<AuthSession | null> {
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

export async function signOut(): Promise<{ success: boolean; error?: string }> {
  try {
    const { signOutSupabase } = await import('./providers/supabase');
    await signOutSupabase();
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}
