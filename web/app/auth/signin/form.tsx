'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { signIn } from 'next-auth/react';

interface SignInFormProps {
  provider: 'supabase' | 'nextauth';
}

export default function SignInForm({ provider }: SignInFormProps) {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard';
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSupabaseAuth = async (oauthProvider: 'google' | 'github') => {
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: oauthProvider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(callbackUrl)}`,
        },
      });
      if (error) {
        setError(error.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleNextAuthOAuth = async (oauthProvider: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await signIn(oauthProvider, { callbackUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900">Hex-YT-Intel</h1>
          <p className="mt-2 text-gray-600">YouTube synthesis engine</p>
        </div>

        <div className="rounded-lg bg-white p-8 shadow-md">
          <h2 className="mb-6 text-center text-2xl font-bold text-gray-900">Sign In</h2>

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded border border-red-200">
              {error}
            </div>
          )}

          {provider === 'supabase' ? (
            <div className="space-y-3">
              <button
                onClick={() => handleSupabaseAuth('google')}
                disabled={isLoading}
                className="w-full rounded-lg bg-white px-4 py-2 text-gray-900 font-medium border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {isLoading ? 'Signing in...' : 'Sign in with Google'}
              </button>
              <button
                onClick={() => handleSupabaseAuth('github')}
                disabled={isLoading}
                className="w-full rounded-lg bg-white px-4 py-2 text-gray-900 font-medium border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {isLoading ? 'Signing in...' : 'Sign in with GitHub'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => handleNextAuthOAuth('google')}
              disabled={isLoading}
              className="w-full rounded-lg bg-white px-4 py-2 text-gray-900 font-medium border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {isLoading ? 'Signing in...' : 'Sign in with Google'}
            </button>
          )}

          <div className="mt-4 text-center text-sm text-gray-500">
            <p>Powered by {provider === 'supabase' ? 'Supabase' : 'NextAuth'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
