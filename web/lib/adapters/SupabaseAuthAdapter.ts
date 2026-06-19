import { getSupabaseClientWithAuth } from '@/lib/supabase';
import type { AuthPort, AuthIdentity } from '@/lib/ports';

export class SupabaseAuthAdapter implements AuthPort {
  async authenticate(): Promise<AuthIdentity | null> {
    const supabase = await getSupabaseClientWithAuth();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('users')
      .select('tier')
      .eq('id', user.id)
      .maybeSingle();

    const tier = error || !data ? 'free' : (data.tier as any) || 'free';
    return { userId: user.id, email: user.email, tier };
  }
}