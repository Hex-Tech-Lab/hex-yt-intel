import { AuthProvider, Session, User } from '../types';
import { getServerSession } from 'next-auth';
import { authConfig } from '../nextauth-config';

export class NextAuthProvider implements AuthProvider {
  async getCurrentSession(): Promise<Session | null> {
    try {
      const session = await getServerSession(authConfig);
      if (!session?.user) return null;

      return {
        user: {
          id: (session.user as any).id,
          email: session.user.email || '',
          name: session.user.name || undefined,
          image: session.user.image || undefined,
          createdAt: new Date(),
        },
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };
    } catch {
      return null;
    }
  }

  async signIn(_provider: string): Promise<void> {
    throw new Error('signIn must be called from client component with next-auth/react');
  }

  async signOut(): Promise<void> {
    throw new Error('signOut must be called from client component with next-auth/react');
  }

  async getUser(): Promise<User | null> {
    const session = await this.getCurrentSession();
    return session?.user || null;
  }

  async updateUser(data: Partial<User>): Promise<User> {
    const session = await this.getCurrentSession();
    if (!session?.user) throw new Error('No session');

    return { ...session.user, ...data };
  }

  async middleware(_req: any): Promise<any> {
    return undefined;
  }

  async handleCallback(_req: any): Promise<Response> {
    return new Response('OK');
  }
}
