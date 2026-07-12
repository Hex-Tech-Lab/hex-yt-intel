'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/templates/_shared/primitives';

/**
 * MobileBreadcrumb Component
 *
 * Shows current page context with back navigation for mobile users.
 * Provides clear navigation feedback and quick access to parent sections.
 *
 * Features:
 * - Touch-friendly back button (48px minimum)
 * - Current page title
 * - Responsive design
 * - WCAG 2.1 AA compliant
 */
interface BreadcrumbItem {
  label: string;
  href: string;
  icon?: string;
}

interface MobileBreadcrumbProps {
  items?: BreadcrumbItem[];
  title?: string;
  showBackButton?: boolean;
  onBack?: () => void;
}

// Route-based breadcrumb configuration
const routeBreadcrumbs: Record<string, BreadcrumbItem[]> = {
  '/dashboard': [{ label: 'Dashboard', href: '/dashboard', icon: 'solar:home-2-linear' }],
  '/search': [
    { label: 'Dashboard', href: '/dashboard', icon: 'solar:home-2-linear' },
    { label: 'Search', href: '/search', icon: 'solar:magnifer-linear' },
  ],
  '/pricing': [{ label: 'Pricing', href: '/pricing', icon: 'solar:tag-linear' }],
};

const routeTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/search': 'Search Analyses',
  '/pricing': 'Pricing Plans',
  '/': 'Hex YT Intel',
};

export function MobileBreadcrumb({
  items,
  title,
  showBackButton = true,
  onBack,
}: MobileBreadcrumbProps) {
  const pathname = usePathname();

  // Determine breadcrumbs from route or provided items
  const breadcrumbs = items || routeBreadcrumbs[pathname] || [];
  const pageTitle = title || routeTitles[pathname] || 'Navigation';

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      // Default: go back in browser history
      if (typeof window !== 'undefined') {
        window.history.back();
      }
    }
  };

  // Only show on mobile/tablet
  return (
    <div className="lg:hidden bg-[var(--surface)] border-b border-[var(--line)]">
      {/* Back Button + Title Row */}
      {showBackButton && breadcrumbs.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--line)]">
          <button
            onClick={handleBack}
            aria-label="Go back to previous page"
            className="grid place-items-center w-12 h-12 flex-shrink-0 rounded-lg border border-[var(--line)] bg-[var(--void)] text-[var(--ink-secondary)] hover:bg-[var(--surface)] transition-colors active:scale-95"
            aria-expanded="false"
          >
            <Icon icon="solar:arrow-left-linear" size={20} />
          </button>
          <h1 className="flex-1 text-sm font-semibold text-[var(--ink)] truncate">
            {pageTitle}
          </h1>
        </div>
      )}

      {/* Breadcrumb Trail */}
      {breadcrumbs.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto">
          {breadcrumbs.map((crumb, index) => {
            const isLast = index === breadcrumbs.length - 1;
            return (
              <div key={crumb.href} className="flex items-center gap-2 flex-shrink-0">
                {index > 0 && (
                  <Icon
                    icon="solar:alt-arrow-right-linear"
                    size={14}
                    className="text-[var(--ink-muted)] flex-shrink-0"
                  />
                )}
                {isLast ? (
                  <div className="flex items-center gap-1">
                    {crumb.icon && (
                      <Icon
                        icon={crumb.icon}
                        size={14}
                        className="text-[var(--accent)] flex-shrink-0"
                      />
                    )}
                    <span className="text-xs font-medium text-[var(--accent)] truncate">
                      {crumb.label}
                    </span>
                  </div>
                ) : (
                  <Link
                    href={crumb.href}
                    className="flex items-center gap-1 text-xs font-medium text-[var(--ink-secondary)] hover:text-[var(--accent)] transition-colors truncate"
                  >
                    {crumb.icon && (
                      <Icon
                        icon={crumb.icon}
                        size={14}
                        className="flex-shrink-0"
                      />
                    )}
                    <span className="truncate">{crumb.label}</span>
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
