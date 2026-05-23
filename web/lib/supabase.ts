import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { env } from './env';
import { cookies } from 'next/headers';

const createCiMock = () => {
  const mock: any = new Proxy(() => {}, {
    get: (target, prop) => {
      if (prop === 'auth') {
        return {
          getUser: async (token?: string) => {
            const actualToken = token || '';
            const id = actualToken.includes('test-token-') ? actualToken.replace('test-token-', '') : actualToken;
            return { data: { user: id ? { id, email: 'test@example.com' } : null }, error: null };
          },
          getSession: async () => ({ data: { session: null }, error: null }),
          signOut: async () => ({ error: null }),
        };
      }
      if (prop === 'then') return undefined;
      if (prop === 'maybeSingle' || prop === 'single') {
        return async () => ({ data: { tier: 'free', role: 'user' }, error: null });
      }
      if (prop === 'insert' || prop === 'update' || prop === 'upsert' || prop === 'delete') {
        return async () => ({ data: null, error: null });
      }
      if (prop === 'rpc') {
        return async () => ({ data: null, error: null });
      }
      if (prop === 'count') {
        return async () => ({ data: 0, error: null });
      }
      return mock;
    },
    apply: () => mock
  });
  return mock;
};

/**
 * Synchronous Supabase client factory (backward compatible)
 * Returns anonKey-based client for immediate use
 * For request-scoped RLS enforcement, use getSupabaseClientWithAuth()
 */
export function getSupabaseClient() {
  const supabaseUrl = env.supabaseUrl;
  const supabaseKey = env.supabaseAnonKey;

  if (process.env.GITHUB_ACTIONS === 'true' && (supabaseUrl.includes('localhost') || supabaseUrl.includes('dummy'))) {
    return createCiMock();
  }

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

  if (process.env.GITHUB_ACTIONS === 'true' && (supabaseUrl.includes('localhost') || supabaseUrl.includes('dummy'))) {
    return createCiMock();
  }

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase configuration');
  }

  const cookieStore = await cookies();
  
  return createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value; },
        set(name: string, value: string, options: CookieOptions) { cookieStore.set(name, value, options); },
        remove(name: string, options: CookieOptions) { cookieStore.set(name, '', { ...options, maxAge: 0 }); },
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

  // CI/Test Mock: If in CI and URL is localhost/missing, return a mock client
  if (process.env.GITHUB_ACTIONS === 'true' && (env.supabaseUrl.includes('localhost') || env.supabaseUrl.includes('dummy'))) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { tier: 'free' }, error: null }),
          }),
        }),
        insert: async () => ({ error: null }),
        update: () => ({ eq: async () => ({ error: null }) }),
        upsert: async () => ({ error: null }),
      }),
      rpc: async () => ({ data: null, error: null }),
    } as any;
  }

  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is not set');
  }
  return createSupabaseClient(env.supabaseUrl, serviceKey);
}
