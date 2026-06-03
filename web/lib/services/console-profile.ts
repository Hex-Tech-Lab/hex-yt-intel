import 'server-only';
import { getSupabaseClientWithAuth } from '@/lib/supabase';

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
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // RLS is disabled on public.users (OAuth signup path); the authed client can
  // read the caller's own row directly.
  const { data: row } = await supabase
    .from('users')
    .select('email, name, tier, role, analyses_used')
    .eq('id', user.id)
    .maybeSingle();

  const email = (row?.email as string) || user.email || '';
  const name = (row?.name as string) ?? null;
  const tier = (row?.tier as string) || 'free';

  return {
    userId: user.id,
    email,
    name,
    tier,
    role: (row?.role as string) ?? null,
    analysesUsed: (row?.analyses_used as number) ?? 0,
    monthlyLimit: MONTHLY_LIMIT_BY_TIER[tier] ?? null,
    initials: computeInitials(name, email),
  };
}
