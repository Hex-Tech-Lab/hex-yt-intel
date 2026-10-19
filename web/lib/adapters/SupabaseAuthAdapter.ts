import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { normalizeUserTier } from '@/lib/types/billing';
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

    let userId: string | null = null;
    let email: string | undefined = undefined;

    // Fast-path: local JWT claim verification via getClaims() to avoid network round-trip
    try {
      if (typeof (supabase.auth as any).getClaims === 'function') {
        const claimsRes = await (supabase.auth as any).getClaims();
        const claims = claimsRes?.data?.claims;
        if (claims?.sub) {
          userId = claims.sub;
          email = typeof claims.email === 'string' ? claims.email : undefined;
        }
      }
    } catch {
      // Fall through to getUser() network verification
    }

    // Fallback: network round trip to getUser()
    if (!userId) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      userId = user.id;
      email = user.email;
    }

    const { data, error } = await supabase
      .from('users')
      .select('tier')
      .eq('id', userId)
      .maybeSingle();

    const tier = error || !data ? 'free' : normalizeUserTier(data.tier);
    return { userId, email, tier };
  }
}