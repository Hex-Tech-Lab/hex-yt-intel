import type { NextAuthOptions } from 'next-auth';
import type { Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import { AUTH_CONFIG } from './config';

export const authConfig: NextAuthOptions = {
  providers: [
    {
      id: 'google',
      name: 'Google',
      type: 'oauth',
      authorization: { params: { prompt: 'consent' } },
      clientId: AUTH_CONFIG.google.clientId || '',
      clientSecret: AUTH_CONFIG.google.clientSecret || '',
      wellKnown: 'https://accounts.google.com/.well-known/openid-configuration',
      profile(profile: any) {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: profile.picture,
        };
      },
    },
  ],
  callbacks: {
    async jwt({ token, user }: { token: JWT; user?: any }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
  },
  secret: AUTH_CONFIG.providers.nextauth.secret || 'dev-secret-change-in-production',
};
