/**
 * Environment variable validation for auth configuration
 * Runs at startup to catch missing config early with helpful errors
 */

export function validateAuthConfig(): void {
  // Required for Supabase Auth
  const allRequired = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  const missing = Object.entries(allRequired)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    const vars = missing.join(', ');
    throw new Error(
      `Missing required environment variables: ${vars}\n` +
      `See .env.example for configuration instructions.`
    );
  }
}
