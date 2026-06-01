'use client';

import type { User } from '@supabase/supabase-js';
import { createClient } from '@/utils/supabase/client';
import { useRouter } from 'next/navigation';

export function UserMenu({ user }: { user: User }) {
  const router = useRouter();
  const supabase = createClient();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  return (
    <>
      <span className="text-sm text-text-secondary">{user.email}</span>
      <button
        onClick={handleSignOut}
        className="px-3 py-2 text-sm font-medium text-text-secondary hover:bg-surface/80 hover:text-accent transition-colors rounded"
      >
        Sign Out
      </button>
    </>
  );
}
