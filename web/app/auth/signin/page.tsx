import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import SignInForm from './form';
import { loadConsoleProfile } from '@/lib/services/console-profile';

export const dynamic = 'force-dynamic';

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Auth guard: an already-signed-in user should never sit on the sign-in
  // screen. On mobile the device Back button pops history to /auth/signin
  // (the OAuth flow leaves it on the stack), which read as "Back dumps me at
  // sign-in". Bounce authenticated users forward into the app instead, so Back
  // effectively returns them to the console.
  const profile = await loadConsoleProfile();
  if (profile) {
    const { next } = await searchParams;
    // Only honour app-internal paths to avoid an open-redirect via ?next=.
    const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
    redirect(dest);
  }

  return (
    <Suspense fallback={<div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "var(--void)", color: "var(--ink-muted)", fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase" as const }}>Loading...</div>}>
      <SignInForm />
    </Suspense>
  );
}
