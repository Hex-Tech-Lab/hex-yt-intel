import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
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

  // CI/Test Mock: If in CI and URL is localhost/missing, return a mock client
  if (process.env.GITHUB_ACTIONS === 'true' && (supabaseUrl.includes('localhost') || supabaseUrl.includes('dummy'))) {
    return {
      from: (table: string) => ({
        select: (columns: string) => ({
          eq: (col: string, val: string) => {
            if (table === 'users' && col === 'id') {
              let tier = 'free';
              if (val.includes('pro')) tier = 'pro';
              if (val.includes('enterprise') || val.includes('admin')) tier = 'enterprise';
              return { maybeSingle: async () => ({ data: { tier, id: val }, error: null }) };
            }
            return { maybeSingle: async () => ({ data: null, error: null }) };
          },
        }),
        insert: async () => ({ error: null }),
      }),
    } as any;
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

  // CI/Test Mock: If in CI and URL is localhost/missing, return a mock client
  if (process.env.GITHUB_ACTIONS === 'true' && (supabaseUrl.includes('localhost') || supabaseUrl.includes('dummy'))) {
    return {
      auth: {
        getUser: async (token?: string) => {
          const actualToken = token || '';
          const id = actualToken.includes('test-token-') ? actualToken.replace('test-token-', '') : actualToken;
          if (id) {
            return { data: { user: { id, email: 'test@example.com' } }, error: null };
          }
          return { data: { user: null }, error: new Error('Mock unauthorized') };
        },
        getSession: async () => ({ data: { session: null }, error: null }),
        signOut: async () => ({ error: null }),
      },
      from: (table: string) => ({
        select: (columns: string) => ({
          eq: (col: string, val: string) => {
            // Handle Quota checks in E2E tests
            if (table === 'users' && col === 'id') {
              let tier = 'free';
              if (val.includes('pro')) tier = 'pro';
              if (val.includes('enterprise') || val.includes('admin')) tier = 'enterprise';
              return { maybeSingle: async () => ({ data: { tier, id: val }, error: null }) };
            }
            if (table === 'usage_logs' && col === 'user_id') {
              let count = 0;
              if (val.includes('near-quota')) count = 2;
              if (val.includes('over-quota')) count = 5; // Force 429
              return { 
                gte: () => ({
                  order: () => ({ limit: async () => ({ data: Array(count).fill({ id: 'log' }), error: null }) })
                }),
                select: () => ({
                  gte: async () => ({ data: Array(count).fill({ id: 'log' }), error: null })
                })
              };
            }
            return {
              maybeSingle: async () => ({ data: null, error: null }),
              order: () => ({ limit: async () => ({ data: [], error: null }) }),
              gte: () => ({ count: async () => ({ data: 0, error: null }) }),
            };
          },
        }),
        insert: async () => ({ error: null }),
        upsert: async () => ({ error: null }),
      }),
    } as any;
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
