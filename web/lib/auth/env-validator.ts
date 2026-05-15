/**
 * Environment variable validation for auth configuration
 * Runs at startup to catch missing config early with helpful errors
 */

export function validateAuthConfig(): void {
  const provider = process.env.AUTH_PROVIDER || 'supabase';

  // Always required
  const required = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  // Required if using NextAuth
  const nextAuthRequired =
    provider === 'nextauth'
      ? {
          NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
          AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
          AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
        }
      : {};

  const allRequired = { ...required, ...nextAuthRequired };
  const missing = Object.entries(allRequired)
    .filter(([_, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    const vars = missing.join(', ');
    throw new Error(
      `Missing required environment variables: ${vars}\n` +
      `See .env.example for configuration instructions.\n` +
      `Current AUTH_PROVIDER: ${provider}`
    );
  }
}
