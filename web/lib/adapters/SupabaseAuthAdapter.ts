import { getSupabaseClientWithAuth } from '@/lib/supabase';
import type { AuthPort, AuthIdentity } from '@/lib/ports';

/**
 * Supabase implementation of authentication and user tier resolution.
 * Retrieves the current user from Supabase auth and looks up their subscription tier.
 */
export class SupabaseAuthAdapter implements AuthPort {
  /**
   * Authenticate the current user and return their identity with tier.
   * @returns AuthIdentity with userId, email, and tier, or null if not authenticated
   */
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