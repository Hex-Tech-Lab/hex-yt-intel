'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

export default function SignInForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSupabaseAuth = async (oauthProvider: 'google') => {
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
      // Note: redirectTo will handle the actual navigation if successful
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

        <div className="rounded-lg bg-surface p-8 shadow-md">
          <h2 className="mb-6 text-center text-2xl font-bold text-gray-900">Sign In</h2>

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded border border-red-200">
              {error}
            </div>
          )}

          <button
            onClick={() => handleSupabaseAuth('google')}
            disabled={isLoading}
            className="w-full rounded-lg bg-surface px-4 py-2 text-gray-900 font-medium border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {isLoading ? 'Signing in...' : 'Sign in with Google'}
          </button>

          <div className="mt-4 text-center text-sm text-gray-500">
            <p>Powered by Supabase</p>
          </div>
        </div>
      </div>
    </div>
  );
}
