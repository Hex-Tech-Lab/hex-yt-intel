'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@astryxdesign/core';
import { getSupabaseBrowserClient } from '@/utils/supabase/client';
import type { User } from '@supabase/supabase-js';

export function UserMenu({ user }: { user: User }) {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  const handleSignOut = async () => {
    // Same defensive fix as DashboardContainer.tsx's handleSignOut -- a
    // hung/slow signOut() call must never block navigating away (live user
    // report, 2026-09-08).
    try {
      await Promise.race([
        supabase.auth.signOut(),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('signOut timed out')), 5000)),
      ]);
    } catch (err) {
      console.warn('[UserMenu] signOut did not complete cleanly, navigating away regardless:', err);
    } finally {
      router.push('/');
    }
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
