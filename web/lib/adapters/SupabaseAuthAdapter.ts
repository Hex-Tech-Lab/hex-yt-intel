import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { getUserTier } from '@/lib/services/traffic';
import type { IAuthPort, AuthIdentity } from '@/lib/ports/IAuthPort';

export class SupabaseAuthAdapter implements IAuthPort {
  async authenticate(): Promise<AuthIdentity | null> {
    const supabase = await getSupabaseClientWithAuth();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const tier = (await getUserTier(user.id)) ?? 'free';
    return { userId: user.id, email: user.email, tier };
  }
}