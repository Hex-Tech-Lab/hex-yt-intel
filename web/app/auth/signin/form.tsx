'use client';

import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';

export default function SignInForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard';

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900">Hex-YT-Intel</h1>
          <p className="mt-2 text-gray-600">YouTube synthesis engine</p>
        </div>

        <div className="rounded-lg bg-white p-8 shadow-md">
          <h2 className="mb-6 text-center text-2xl font-bold text-gray-900">Sign In</h2>

          <button
            onClick={() => signIn('google', { callbackUrl })}
            className="w-full rounded-lg bg-white px-4 py-2 text-gray-900 font-medium border border-gray-300 hover:bg-gray-50 transition"
          >
            Sign in with Google
          </button>

          <div className="mt-4 text-center text-sm text-gray-500">
            <p>Demo mode: OAuth credentials from .env</p>
          </div>
        </div>
      </div>
    </div>
  );
}
