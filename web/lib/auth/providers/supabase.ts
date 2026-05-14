import { AuthProvider, Session, User } from '../types';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export class SupabaseAuthProvider implements AuthProvider {
  private supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  );

  async getCurrentSession(): Promise<Session | null> {
    try {
      const cookieStore = await cookies();
      const token = cookieStore.get('sb:token')?.value;

      if (!token) {
        const { data, error } = await this.supabase.auth.getSession();
        if (error || !data.session) return null;

        return {
          user: {
            id: data.session.user.id,
            email: data.session.user.email || '',
            name: data.session.user.user_metadata?.name || undefined,
            image: data.session.user.user_metadata?.picture || undefined,
            createdAt: new Date(data.session.user.created_at),
          },
          expiresAt: new Date(data.session.expires_at * 1000),
        };
      }

      const { data, error } = await this.supabase.auth.getUser(token);
      if (error || !data.user) return null;

      return {
        user: {
          id: data.user.id,
          email: data.user.email || '',
          name: data.user.user_metadata?.name || undefined,
          image: data.user.user_metadata?.picture || undefined,
          createdAt: new Date(data.user.created_at),
        },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
    } catch {
      return null;
    }
  }

  async signIn(provider: string): Promise<void> {
    if (typeof window === 'undefined') {
      throw new Error('signIn must be called from client component');
    }

    const { error } = await this.supabase.auth.signInWithOAuth({
      provider: provider as any,
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback`,
      },
    });

    if (error) throw error;
  }

  async signOut(): Promise<void> {
    const { error } = await this.supabase.auth.signOut();
    if (error) throw error;
  }

  async getUser(): Promise<User | null> {
    const session = await this.getCurrentSession();
    return session?.user || null;
  }

  async updateUser(data: Partial<User>): Promise<User> {
    const session = await this.getCurrentSession();
    if (!session?.user) throw new Error('No session');

    const { data: updated, error } = await this.supabase.auth.updateUser({
      data: {
        name: data.name,
        picture: data.image,
      },
    });

    if (error) throw error;

    return {
      ...session.user,
      ...data,
    };
  }

  async middleware(req: any): Promise<any> {
    return undefined;
  }

  async handleCallback(req: any): Promise<Response> {
    const code = req.nextUrl.searchParams.get('code');
    if (!code) {
      return new Response('No code provided', { status: 400 });
    }

    try {
      const { data, error } = await this.supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;

      // Store session in cookie
      const cookieStore = await cookies();
      cookieStore.set('sb:token', data.session?.access_token || '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30,
      });

      return new Response('OK');
    } catch (error) {
      return new Response('Authentication failed', { status: 401 });
    }
  }
}
