'use client';

import Link from 'next/link';
import { TopNavHeading, TopNavItem, IconButton, Button } from '@astryxdesign/core';
import { Icon } from '@/components/templates/_shared/primitives';
import { useUIStore } from '@/store/useUIStore';
import type { User } from '@supabase/supabase-js';

/**
 * ResponsiveHeader Component
 *
 * A fully responsive header that adapts to mobile, tablet, and desktop screens.
 * Features:
 * - Hamburger menu on mobile (< lg)
 * - Full navigation bar on desktop (lg+)
 * - Touch-friendly button sizes (48px minimum)
 * - Smooth transitions
 * - Accessibility compliant (WCAG 2.1 AA)
 */
export function ResponsiveHeader({ user }: { user?: User | null }) {
  const setMobileNav = useUIStore((s) => s.setMobileNav);
  const mobileNavOpen = useUIStore((s) => s.mobileNavOpen);
  const safeUser = user ?? null;

  const handleMobileMenuOpen = () => {
    setMobileNav(true);
  };

  return (
    <header className="sticky top-0 z-50 bg-[var(--void)] border-b border-[var(--line)] backdrop-blur-md">
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
        {/* Logo / Branding */}
        <TopNavHeading
          as={Link}
          headingHref="/"
          heading="HEX·YT·INTEL"
          logo={
            <div className="grid place-items-center w-7 h-7 sm:w-8 sm:h-8 rounded bg-[var(--accent)] flex-shrink-0">
              <Icon icon="solar:graph-up-linear" size={16} className="text-[var(--void)]" />
            </div>
          }
          className="font-mono"
        />

        {/* Desktop Navigation - Hidden on mobile */}
        <nav className="hidden lg:flex items-center gap-6 flex-1 mx-6" aria-label="Main">
          {safeUser && (
            <>
              <TopNavItem as={Link} href="/dashboard" label="Dashboard" />
              <TopNavItem as={Link} href="/search" label="Search" />
            </>
          )}
          <TopNavItem as={Link} href="/pricing" label="Pricing" />
        </nav>

        <div className="flex-1" />

        {/* Right Section */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Desktop Auth Button - Hidden on mobile */}
          <div className="hidden sm:block">
            {safeUser ? (
              <div className="flex items-center gap-2 sm:gap-3">
                <span className="hidden md:block text-xs text-[var(--ink-muted)] max-w-[150px] truncate">
                  {safeUser.email}
                </span>
                <Button as={Link} href="/dashboard" label="Dashboard" variant="primary" size="sm" />
              </div>
            ) : (
              <Button as={Link} href="/auth/signin" label="Sign In" variant="primary" size="sm" />
            )}
          </div>

          {/* Mobile Menu Button - Visible on mobile only */}
          <IconButton
            label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
            variant="secondary"
            icon={<Icon icon="solar:hamburger-menu-linear" size={20} />}
            onClick={handleMobileMenuOpen}
            className="lg:hidden flex-shrink-0"
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-menu"
          />
        </div>
      </div>
    </header>
  );
}
