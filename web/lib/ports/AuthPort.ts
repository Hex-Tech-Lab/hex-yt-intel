import type { UserTier } from '@/lib/types/billing';

/** Identity extracted from the verified Supabase session. */
export interface AuthIdentity {
  userId: string;
  email: string | undefined;
  tier: UserTier;
}

/**
 * Verifies the request carries a valid Supabase session and resolves the
 * user's subscription tier. Returns null when the session is missing or
 * invalid — the controller maps null → 401.
 *
 * Current implementation: getSupabaseClientWithAuth() + getUser() + getUserTier()
 */
export interface AuthPort {
  /**
   * Authenticate the incoming request.
   * @returns AuthIdentity on success, null if session is missing/invalid.
   */
  authenticate(): Promise<AuthIdentity | null>;
}