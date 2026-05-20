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
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is not set');
  }
  return createSupabaseClient(env.supabaseUrl, serviceKey);
}
