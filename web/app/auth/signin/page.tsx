import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import SignInForm from './form';
import { loadConsoleProfile } from '@/lib/services/console-profile';
import { resolveTestAuthBypassEnabled } from '@/lib/config/test-auth';

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

  // Real gap found 2026-08-20: TestSprite's browser automation can only fill
  // real form fields and click buttons -- it cannot issue a raw POST with a
  // custom header, which blocked every authenticated test case against the
  // header-based bypass route. Supabase's Email provider is already enabled
  // (confirmed live in the dashboard); this shows a real email/password
  // field -- Supabase's own signInWithPassword, no custom mechanism -- gated
  // behind the SAME testAuthBypass.enabled registry toggle that already
  // governs the header-based route, so it's off by default in production
  // and only appears when explicitly enabled for a test run. Only the one
  // pre-existing test account has a password set at all (real Google-OAuth
  // users have none), so this can't be used to sign in as anyone else.
  const testAuthBypassEnabled = await resolveTestAuthBypassEnabled();

  return (
    <Suspense fallback={<div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "var(--void)", color: "var(--ink-muted)", fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase" as const }}>Loading...</div>}>
      <SignInForm showTestAuth={testAuthBypassEnabled} />
    </Suspense>
  );
}
