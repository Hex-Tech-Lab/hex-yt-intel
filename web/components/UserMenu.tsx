'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@astryxdesign/core';
import { getSupabaseBrowserClient } from '@/utils/supabase/client';
import { signOutWithTimeout } from '@/lib/utils/sign-out-with-timeout';
import type { User } from '@supabase/supabase-js';

export function UserMenu({ user }: { user: User }) {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  const handleSignOut = async () => {
    // Shared with DashboardContainer.tsx's handleSignOut -- a hung/slow
    // signOut() call must never block navigating away (live user report,
    // 2026-09-08), and a resolved `{ error }` must not be silently treated
    // as success (deeper review, PR #299).
    await signOutWithTimeout(supabase, '[UserMenu]');
    router.push('/');
  };

  return (
    <>
      <span className="text-sm text-text-secondary">{user.email}</span>
      <Button
        label="Sign Out"
        variant="ghost"
        size="sm"
        onClick={handleSignOut}
        className="text-sm font-medium text-text-secondary hover:bg-surface/80 hover:text-accent transition-colors"
      />
    </>
  );
}
