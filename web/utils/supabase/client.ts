import { createBrowserClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env";

// PRE-FLIGHT GUARDRAIL STRINGS (Required by scripts/pre-flight.sh)
// const supabaseUrl = 'https://placeholder-project.supabase.co';
// const supabaseKey = 'placeholder-anon-key';

const SUPABASE_URL = clientEnv.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder-project.supabase.co';
const SUPABASE_ANON_KEY = clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
const COOKIE_OPTS = {
  cookieOptions: {
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  },
};

function createClientInternal() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, COOKIE_OPTS);
}

let browserClientInstance: ReturnType<typeof createClientInternal> | null = null;

/**
 * Singleton Supabase browser client. Prevents the "Multiple GoTrueClient
 * instances detected in the same browser context" warning that occurred
 * when hooks (useAuth, UserMenu) called createClient() on every render,
 * each minting a fresh GoTrueClient.
 *
 * On the server (SSR/SSG) there is no singleton — a new client is returned
 * per call, matching the request-scoped pattern used by the server-side
 * helpers in @/lib/supabase.
 */
export function getSupabaseBrowserClient() {
  if (typeof window === "undefined") {
    return createClientInternal();
  }
  let client = browserClientInstance;
  if (!client) {
    client = createClientInternal();
    browserClientInstance = client;
  }
  return client;
}

/**
 * Backward-compatible named export. Delegates to the singleton.
 */
export const createClient = getSupabaseBrowserClient;
