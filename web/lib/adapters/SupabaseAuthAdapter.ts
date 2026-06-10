import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { getUserTier } from '@/lib/services/traffic';
import type { AuthPort, AuthIdentity } from '@/lib/ports';

export class SupabaseAuthAdapter implements AuthPort {
  async authenticate(): Promise<AuthIdentity | null> {
    const supabase = await getSupabaseClientWithAuth();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const tier = (await getUserTier(user.id)) ?? 'free';
    return { userId: user.id, email: user.email, tier };
  }
}