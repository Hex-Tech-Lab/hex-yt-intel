import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { env } from './env';

// `next/headers` is a Next.js server-only module. It is imported LAZILY (inside
// the two request-scoped helpers below) rather than at module scope, because
// this file is also transitively pulled into the Cloudflare Worker bundle (via
// the persistence adapter → settings service → prompt factory). A static
// top-level `import { cookies } from 'next/headers'` made esbuild try to resolve
// a Next-only module for the Worker build, breaking `wrangler deploy`. The
// service-role and anon clients below never touch cookies, so the Worker never
// loads this — the dynamic import only runs in the Next.js request context.
type NextCookies = (typeof import('next/headers'))['cookies'];
let cookiesFn: NextCookies | undefined;
/**
 * Lazily and dynamically load the Next.js server-only `cookies` function.
 *
 * Kept out of module scope (see the block comment above) so `next/headers`
 * never enters the Cloudflare Worker bundle. The result is memoized: the
 * `cookies` export is a stable binding and the per-request work is calling it,
 * not importing it, so caching keeps the request path off repeated `import()`
 * promise churn.
 */
const loadCookies = async (): Promise<NextCookies> => {
  if (!cookiesFn) {
    cookiesFn = (await import('next/headers')).cookies;
  }
  return cookiesFn;
};

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

  let cookieStore: { getAll: () => { name: string; value: string }[]; set: (name: string, value: string, options?: Record<string, unknown>) => void };
  let hasCookies = false;
  try {
    const cookies = await loadCookies();
    cookieStore = await cookies();
    hasCookies = true;
  } catch (cookieError) {
    // Cookieless context (e.g., static generation / build-time page validation),
    // or the server-only `next/headers` module was unavailable. Fall back to a
    // cookieless client. Logged at debug level so the fallback stays observable
    // without adding noise to normal request handling.
    console.debug(
      '[supabase] cookie store unavailable; using cookieless client',
      cookieError instanceof Error ? cookieError.message : String(cookieError),
    );
  }

  return createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          if (!hasCookies || !cookieStore) return [];
          return cookieStore.getAll().map((c: { name: string; value: string }) => ({ name: c.name, value: c.value }));
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
          } catch (writeError) {
            // Called from a Server Component; cookie writes are illegal there and
            // Next.js throws. Ignored — middleware refreshes the session on the
            // next request. Logged at debug level so the swallow stays observable
            // without adding noise (this only fires on a token refresh, not per render).
            console.debug(
              '[supabase] cookie write skipped in RSC context',
              writeError instanceof Error ? writeError.message : String(writeError),
            );
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
    const cookies = await loadCookies();
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
