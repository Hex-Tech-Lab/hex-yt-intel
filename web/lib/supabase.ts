import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { env } from './env';
import { cookies } from 'next/headers';

/**
 * Synchronous Supabase client factory (backward compatible)
 * Returns anonKey-based client for immediate use
 * For request-scoped RLS enforcement, use getSupabaseClientWithAuth()
 */
export function getSupabaseClient() {
  const supabaseUrl = env.supabaseUrl;
  const supabaseKey = env.supabaseAnonKey;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase configuration');
  }

  return createSupabaseClient(supabaseUrl, supabaseKey);
}

/**
 * Request-scoped Supabase client factory
 * Uses authenticated JWT token to enforce RLS policies per user
 * Async to enable cookie/token extraction from request context
 */
export async function getSupabaseClientWithAuth() {
  const supabaseUrl = env.supabaseUrl;
  const supabaseKey = env.supabaseAnonKey;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase configuration');
  }

  let cookieStore: any;
  let hasCookies = false;
  try {
    cookieStore = await cookies();
    hasCookies = true;
  } catch {
    // Cookieless context (e.g., static generation / build-time page validation)
  }

  return createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          if (!hasCookies || !cookieStore) return [];
          return cookieStore.getAll().map((c: any) => ({ name: c.name, value: c.value }));
        },
        setAll(cookiesToSet) {
          if (!hasCookies || !cookieStore) return;
          // Supabase calls setAll when it auto-refreshes an expired access token
          // on read. In a Server Component render, cookie writes are illegal and
          // Next.js throws "Cookies can only be modified in a Server Action or
          // Route Handler" — the source of the fatal 500 for returning authed
          // users. Swallow it: the refreshed session is valid for THIS request,
          // and the new token is persisted on the next request that runs through
          // middleware (/api/*) or a Route Handler. This is the official
          // @supabase/ssr Next.js pattern; in Route Handlers the writes succeed
          // (no throw), in RSC they are safely ignored.
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component; ignored (middleware refreshes the session).
          }
        },
      },
    }
  );
}

/**
 * Create Supabase client with explicit JWT token
 * Enforces RLS by attaching Authorization header with user's JWT
 * Use this in API routes that receive accessToken from session
 */
export function getSupabaseClientWithToken(accessToken: string) {
  const supabaseUrl = env.supabaseUrl;
  const supabaseKey = env.supabaseAnonKey;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase configuration');
  }

  return createSupabaseClient(supabaseUrl, supabaseKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

/**
 * Extract JWT token from request cookies
 * Used for explicit token passing to request-scoped clients
 */
export async function extractUserToken(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('sb-auth-token')?.value;
    return token || null;
  } catch {
    return null;
  }
}

export function getSupabaseServiceClient() {
  const serviceKey = env.supabaseServiceRoleKey;
  const supabaseUrl = env.supabaseUrl;

  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is not set');
  }
  return createSupabaseClient(supabaseUrl, serviceKey);
}
