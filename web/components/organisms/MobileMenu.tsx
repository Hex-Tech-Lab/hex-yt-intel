'use client';

import Link from 'next/link';
import { IconButton, Divider } from '@astryxdesign/core';
import { Icon } from '@/components/templates/_shared/primitives';
import { useUIStore } from '@/store/useUIStore';
import type { User } from '@supabase/supabase-js';

/**
 * MobileMenu Component
 * Responsive navigation menu for mobile/tablet devices with touch-friendly design
 */
export function MobileMenu({ user }: { user?: User | null }) {
  const setMobileNav = useUIStore((s) => s.setMobileNav);
  const safeUser = user ?? null;

  const closeMenu = () => setMobileNav(false);

  return (
    <div className="flex flex-col h-full bg-[var(--void)]">
      {/* Menu Header */}
      <div className="flex items-center justify-between p-4">
        <span className="text-sm font-semibold text-[var(--ink)] uppercase tracking-wide">Menu</span>
        <IconButton
          label="Close menu"
          variant="secondary"
          icon={<Icon icon="solar:close-circle-linear" size={20} />}
          onClick={closeMenu}
        />
      </div>
      <Divider />

      {/* Menu Content */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
        {safeUser && (
          <>
            <Link
              href="/dashboard"
              onClick={closeMenu}
              className="flex items-center gap-3 w-full px-3 py-3 rounded-lg text-[var(--ink)] hover:bg-[var(--surface)] transition-colors text-sm font-medium"
            >
              <Icon icon="solar:home-2-linear" size={20} />
              Dashboard
            </Link>
            <Link
              href="/search"
              onClick={closeMenu}
              className="flex items-center gap-3 w-full px-3 py-3 rounded-lg text-[var(--ink)] hover:bg-[var(--surface)] transition-colors text-sm font-medium"
            >
              <Icon icon="solar:magnifer-linear" size={20} />
              Search
            </Link>
          </>
        )}
        <Link
          href="/pricing"
          onClick={closeMenu}
          className="flex items-center gap-3 w-full px-3 py-3 rounded-lg text-[var(--ink-secondary)] hover:bg-[var(--surface)] transition-colors text-sm"
        >
          <Icon icon="solar:tag-linear" size={18} />
          Pricing
        </Link>
      </nav>

      {/* Menu Footer */}
      <Divider />
      <div className="p-4 space-y-3">
        {safeUser ? (
          <>
            <div className="text-xs text-[var(--ink-muted)] truncate">{safeUser.email}</div>
            <Link
              href="/dashboard"
              onClick={closeMenu}
              className="block w-full px-3 py-3 rounded-lg bg-[var(--accent)] text-[var(--void)] hover:bg-[var(--accent-strong)] transition-colors text-sm font-medium text-center"
            >
              Dashboard
            </Link>
          </>
        ) : (
          <Link
            href="/auth/signin"
            onClick={closeMenu}
            className="block w-full px-3 py-3 rounded-lg bg-[var(--accent)] text-[var(--void)] hover:bg-[var(--accent-strong)] transition-colors text-sm font-medium text-center"
          >
            Sign In
          </Link>
        )}
      </div>
    </div>
  );
}
