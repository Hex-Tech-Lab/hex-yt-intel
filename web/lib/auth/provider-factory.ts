import { NextAuthProvider } from './providers/nextauth';

// Phase 4 (Enterprise): extend this factory to support Supabase Auth and Vercel Auth
// for SSO and multi-provider scenarios. See CLAUDE.md Phase 4 roadmap.
export const authProvider = new NextAuthProvider();
