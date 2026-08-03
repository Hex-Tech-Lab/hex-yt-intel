'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@astryxdesign/core';
import { createClient } from '@/utils/supabase/client';
import type { User } from '@supabase/supabase-js';

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
