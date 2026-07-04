'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

export default function AuthErrorForm() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  const errorMessages: Record<string, string> = {
    Callback: 'Callback error',
    OAuthSignin: 'OAuth signin failed',
    OAuthCallback: 'OAuth callback failed',
    OAuthCreateAccount: 'Could not create OAuth account',
    EmailCreateAccount: 'Could not create email account',
    OAuthAccountNotLinked: 'Email already in use with different provider',
    EmailSignInError: 'Check your email address',
    CredentialsSignin: 'Sign in failed',
    SessionCallback: 'Session callback error',
    admin_check_failed: 'Admin access check failed — please try again shortly',
    default: 'Authentication error',
  };

  const message = error ? errorMessages[error] || errorMessages.default : errorMessages.default;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600">Authentication Error</h1>
          <p className="mt-2 text-gray-600">{message}</p>
        </div>

        <div className="rounded-lg bg-surface p-8 shadow-md text-center">
          <Link href="/auth/signin" className="text-blue-600 hover:underline font-medium">
            Try again
          </Link>
        </div>
      </div>
    </div>
  );
}
