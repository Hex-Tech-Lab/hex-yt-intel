import { AuthProvider, Session, User } from '../types';

export class SupabaseAuthProvider implements AuthProvider {
  constructor(_config: any) {}

  async getCurrentSession(): Promise<Session | null> {
    throw new Error('SupabaseAuthProvider not yet implemented');
  }

  async signIn(_provider: string): Promise<void> {
    throw new Error('SupabaseAuthProvider not yet implemented');
  }

  async signOut(): Promise<void> {
    throw new Error('SupabaseAuthProvider not yet implemented');
  }

  async getUser(): Promise<User | null> {
    throw new Error('SupabaseAuthProvider not yet implemented');
  }

  async updateUser(_data: Partial<User>): Promise<User> {
    throw new Error('SupabaseAuthProvider not yet implemented');
  }

  async middleware(_req: any): Promise<any> {
    throw new Error('SupabaseAuthProvider not yet implemented');
  }

  async handleCallback(_req: any): Promise<Response> {
    throw new Error('SupabaseAuthProvider not yet implemented');
  }
}
