import 'server-only';
import { SupabaseAuthAdapter } from '@lib/adapters/SupabaseAuthAdapter';
import { SupabasePersistenceAdapter } from '@lib/adapters/SupabasePersistenceAdapter';

/**
 * Free-tier monthly analysis allowance. Source of truth is MONTHLY_QUOTAS in
 * `@/lib/rate-limit` and the `increment_user_quota_atomic` Postgres RPC; mirrored
 * here as a plain constant so the server render path does not pull the rate-limit
 * module (Upstash/Sentry) just to label the quota. null = unlimited (pro).
 */
const MONTHLY_LIMIT_BY_TIER: Record<string, number | null> = { free: 3, pro: null };

export interface ConsoleProfile {
  userId: string;
  email: string;
  name: string | null;
  tier: string;
  role: string | null;
  analysesUsed: number;
  monthlyLimit: number | null; // null = unlimited
  initials: string;
}

function computeInitials(name: string | null, email: string): string {
  const src = (name && name.trim()) || email;
  const parts = src.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  const first = parts[0];
  if (!first) return '?';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? first;
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase();
}

/**
 * Server-only loader. Resolves the authenticated user plus their app profile
 * (tier, quota usage) for the Synthesis Console. Returns null when there is no
 * authenticated session, letting each route decide where to send the visitor.
 */
export async function loadConsoleProfile(): Promise<ConsoleProfile | null> {
  const auth = new SupabaseAuthAdapter();
  const identity = await auth.authenticate();
  if (!identity) return null;

  const persistence = new SupabasePersistenceAdapter();
  const row = await persistence.getUserProfile(identity.userId);
  if (!row) return null;

  const email = row.email || identity.email || '';
  const name = row.name;
  const tier = row.tier || 'free';

  return {
    userId: identity.userId,
    email,
    name,
    tier,
    role: row.role,
    analysesUsed: row.analysesUsed,
    monthlyLimit: MONTHLY_LIMIT_BY_TIER[tier] ?? null,
    initials: computeInitials(name, email),
  };
}
