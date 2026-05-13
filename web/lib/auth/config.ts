export const AUTH_CONFIG = {
  provider: (process.env.AUTH_PROVIDER || 'nextauth') as 'vercel' | 'supabase' | 'nextauth',

  google: {
    clientId: process.env.GOOGLE_ID || '',
    clientSecret: process.env.GOOGLE_SECRET || '',
    redirectUri: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/auth/callback/google`,
  },

  providers: {
    vercel: {
      projectId: process.env.VERCEL_PROJECT_ID,
      team: process.env.VERCEL_TEAM_ID,
    },
    supabase: {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
    nextauth: {
      secret: process.env.NEXTAUTH_SECRET,
      url: process.env.NEXTAUTH_URL,
    },
  },
};

if (!AUTH_CONFIG.google.clientId && process.env.NODE_ENV === 'production') {
  console.warn('⚠️ GOOGLE_ID not set. Google OAuth disabled.');
}
