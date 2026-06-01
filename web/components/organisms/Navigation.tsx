import Link from 'next/link';
import type { User } from '@supabase/supabase-js';
import { UserMenu } from '@/components/UserMenu';

export async function Navigation({ user }: { user?: User | null }) {
  const safeUser = user ?? null;

  return (
    <nav className="sticky top-0 z-50 bg-surface border-b border-border px-4 py-3 flex items-center justify-between">
      {/* Logo / Title (Left) */}
      <div className="flex items-center gap-4">
        <Link href="/" className="text-xl font-bold text-white hover:text-accent transition-colors">
          Hex-YT-Intel
        </Link>
        {safeUser && (
          <Link href="/dashboard" className="text-sm font-medium text-text-secondary hover:text-white transition-colors">
            Dashboard
          </Link>
        )}
      </div>

      {/* User Menu (Right) */}
      <div className="flex items-center gap-4">
        {safeUser ? (
          <UserMenu user={safeUser} />
        ) : (
          <Link href="/auth/signin" className="text-sm font-medium text-text-secondary hover:text-accent transition-colors">
            Sign In
          </Link>
        )}
      </div>
    </nav>
  );
}
