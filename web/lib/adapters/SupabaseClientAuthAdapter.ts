import { getSupabaseBrowserClient } from '@/utils/supabase/client';

export interface ClientAuthSession {
  userId: string | null;
}

export interface ClientAuthPort {
  getSessionUserId(): Promise<string | null>;
  onAuthStateChange(callback: (event: string, userId: string | null) => void): () => void;
}

export class SupabaseClientAuthAdapter implements ClientAuthPort {
  async getSessionUserId(): Promise<string | null> {
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id || null;
  }

  onAuthStateChange(callback: (event: string, userId: string | null) => void): () => void {
    const supabase = getSupabaseBrowserClient();
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      callback(event, session?.user?.id || null);
    });
    return () => {
      listener.subscription.unsubscribe();
    };
  }
}

export const clientAuthAdapter = new SupabaseClientAuthAdapter();
