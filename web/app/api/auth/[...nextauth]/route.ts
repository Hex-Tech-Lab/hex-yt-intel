export const dynamic = 'force-dynamic';

import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth/nextauth-config';

const handler = NextAuth(authConfig);

export { handler as GET, handler as POST };
