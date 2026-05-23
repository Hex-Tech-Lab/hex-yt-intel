import type { User as SupabaseUser, Session as SupabaseSession } from '@supabase/supabase-js';

export type User = SupabaseUser;
export type Session = SupabaseSession;

export interface AuthProvider {
  getCurrentSession(): Promise<Session | null>;
  signIn(provider: string): Promise<void>;
  signOut(): Promise<void>;
  getUser(): Promise<User | null>;
  updateUser(data: any): Promise<User>;
}
