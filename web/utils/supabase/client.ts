import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Missing required Supabase environment variables:\n' +
      `NEXT_PUBLIC_SUPABASE_URL: ${url ? '✓' : '✗'}\n` +
      `NEXT_PUBLIC_SUPABASE_ANON_KEY: ${anonKey ? '✓' : '✗'}`
    );
  }

  return createBrowserClient(url, anonKey);
}
