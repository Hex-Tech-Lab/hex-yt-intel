import { Suspense } from 'react';
import SignInForm from './form';
import { AUTH_CONFIG } from '@/lib/auth/config';

export default function SignIn() {
  const provider = AUTH_CONFIG.provider === 'supabase' ? 'supabase' : 'nextauth';

  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Loading...</div>}>
      <SignInForm provider={provider} />
    </Suspense>
  );
}
