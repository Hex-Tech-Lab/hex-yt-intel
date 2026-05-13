export interface User {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  tier?: 'free' | 'pro' | 'startup' | 'sme';
  createdAt: Date;
}

export interface Session {
  user: User;
  expiresAt: Date;
}

export interface AuthProvider {
  getCurrentSession(): Promise<Session | null>;
  signIn(provider: string): Promise<void>;
  signOut(): Promise<void>;
  getUser(): Promise<User | null>;
  updateUser(data: Partial<User>): Promise<User>;
  middleware(req: any): Promise<any>;
  handleCallback(req: any): Promise<Response>;
}
