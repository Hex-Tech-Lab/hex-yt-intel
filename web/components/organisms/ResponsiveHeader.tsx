'use client';

import Link from 'next/link';
import type { User } from '@supabase/supabase-js';
import { Icon } from '@/components/templates/_shared/primitives';
import { useUIStore } from '@/store/useUIStore';

/**
 * ResponsiveHeader Component
 * Fully responsive navigation header for mobile, tablet, and desktop
 */
export function ResponsiveHeader({ user }: { user?: User | null }) {
  const setMobileNav = useUIStore((s) => s.setMobileNav);
  const safeUser = user ?? null;

  return (
    <header className="sticky top-0 z-50 bg-[var(--void)] border-b border-[var(--line)] backdrop-blur-md">
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
        {/* Logo / Branding */}
        <Link
          href="/"
          className="flex items-center gap-2 flex-shrink-0 hover:opacity-80 transition-opacity"
          aria-label="Hex YT Intel home"
        >
          <div className="grid place-items-center w-7 h-7 sm:w-8 sm:h-8 rounded bg-[var(--accent)] flex-shrink-0">
            <Icon icon="solar:graph-up-linear" size={16} className="text-[var(--void)]" />
          </div>
          <span className="hidden sm:block font-mono text-xs sm:text-sm font-semibold tracking-wider text-[var(--ink)]">
            HEX·YT·INTEL
          </span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden lg:flex items-center gap-6 flex-1 mx-6">
          {safeUser && (
            <>
              <Link href="/dashboard" className="text-sm font-medium text-[var(--ink-secondary)] hover:text-[var(--accent)] transition-colors">
                Dashboard
              </Link>
              <Link href="/search" className="text-sm font-medium text-[var(--ink-secondary)] hover:text-[var(--accent)] transition-colors">
                Search
              </Link>
            </>
          )}
          <Link href="/pricing" className="text-sm font-medium text-[var(--ink-secondary)] hover:text-[var(--accent)] transition-colors">
            Pricing
          </Link>
        </nav>

        <div className="flex-1" />

        {/* Right Section */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Desktop Auth Button */}
          <div className="hidden sm:block">
            {safeUser ? (
              <div className="flex items-center gap-2 sm:gap-3">
                <span className="hidden md:block text-xs text-[var(--ink-muted)] max-w-[150px] truncate">
                  {safeUser.email}
                </span>
                <Link href="/dashboard" className="px-3 py-2 text-xs sm:text-sm font-medium bg-[var(--accent)] text-[var(--void)] rounded hover:bg-[var(--accent-strong)] transition-colors">
                  Dashboard
                </Link>
              </div>
            ) : (
              <Link href="/auth/signin" className="px-3 py-2 text-xs sm:text-sm font-medium bg-[var(--accent)] text-[var(--void)] rounded hover:bg-[var(--accent-strong)] transition-colors">
                Sign In
              </Link>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileNav(true)}
            aria-label="Open navigation menu"
            className="lg:hidden grid place-items-center w-10 h-10 sm:w-11 sm:h-11 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-secondary)] hover:bg-[var(--line-faint)] transition-colors flex-shrink-0"
          >
            <Icon icon="solar:hamburger-menu-linear" size={20} />
          </button>
        </div>
      </div>
    </header>
  );
}
