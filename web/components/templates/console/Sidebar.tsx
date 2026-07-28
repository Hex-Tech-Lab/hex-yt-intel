'use client';

import { memo } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { SideNavHeading, SideNavItem, NavIcon, Badge, Divider } from '@astryxdesign/core';
import { Icon } from '@/components/templates/_shared/primitives';

// Reuses the landing page's fadeUp entrance language (web/app/landing-page.tsx)
// for visual consistency: nav items animate in on mount rather than simply
// existing, one staggered choreography vocabulary across the app.
const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

export interface SidebarSubmenuLeaf {
  key: string;
  label: string;
  icon?: string;
  /** Groups leaves under an uppercase category header, matching the
   *  SettingsPanel tree convention. Leaves without a category render flat
   *  (e.g. "Overview"). */
  category?: string;
}

export interface SidebarItem {
  key: string;
  label: string;
  icon: string;
  badge?: string;
  /** When present, the item becomes a collapsible disclosure node instead
   *  of a direct navigation link -- clicking it toggles expand/collapse
   *  (via onToggleSubmenu) rather than calling onNavigate. Its leaves are
   *  rendered inline underneath when expanded. */
  submenu?: SidebarSubmenuLeaf[];
}

export interface RepoScope {
  label: string;
  onClick: () => void;
}

export interface SidebarProps {
  items: SidebarItem[];
  activeKey: string;
  onNavigate: (key: string) => void;
  repoScope?: RepoScope;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** Keys of items whose submenu is currently expanded. */
  expandedKeys?: Record<string, boolean>;
  /** Called instead of onNavigate when a submenu-bearing item is clicked. */
  onToggleSubmenu?: (key: string) => void;
  /** Currently selected submenu leaf, if any (used for leaf highlighting). */
  activeSubKey?: string | null;
  /** Called when a submenu leaf is clicked. */
  onNavigateSub?: (parentKey: string, leafKey: string) => void;
}

function SidebarImpl({
  items,
  activeKey,
  onNavigate,
  repoScope,
  children,
  footer,
  expandedKeys,
  onToggleSubmenu,
  activeSubKey,
  onNavigateSub,
}: SidebarProps) {
  return (
    <div className="flex flex-col h-full py-6 px-3.5">
      {/* brand */}
      <div className="pb-8">
        <SideNavHeading
          as={Link}
          headingHref="/?v=landing"
          heading={`HEX${"\u00b7"}YT`}
          icon={<NavIcon icon={<Icon icon="solar:graph-up-linear" size={18} />} />}
        />
      </div>

      {/* nav */}
      <nav className="flex flex-col gap-1 flex-1">
        {items.map((it, index) => {
          const active = it.key === activeKey;
          const hasSubmenu = !!it.submenu && it.submenu.length > 0;
          const isExpanded = hasSubmenu && !!expandedKeys?.[it.key];
          const entrance = {
            initial: 'hidden' as const,
            animate: 'show' as const,
            variants: fadeUp,
            transition: { duration: 0.35, delay: index * 0.05, ease: [0.16, 1, 0.3, 1] as const },
          };

          if (!hasSubmenu) {
            return (
              <motion.div key={it.key} {...entrance}>
                <SideNavItem
                  label={it.label}
                  icon={<Icon icon={it.icon} size={18} />}
                  isSelected={active}
                  onClick={() => onNavigate(it.key)}
                  endContent={it.badge ? <Badge variant={active ? 'cyan' : 'neutral'} label={it.badge} /> : undefined}
                />
              </motion.div>
            );
          }

          let lastCategory: string | undefined;

          return (
            <motion.div key={it.key} {...entrance} className="flex flex-col gap-1">
              <SideNavItem
                label={it.label}
                icon={<Icon icon={it.icon} size={18} />}
                isSelected={active}
                onClick={() => onToggleSubmenu?.(it.key)}
                endContent={
                  <Icon
                    icon={isExpanded ? 'solar:alt-arrow-up-linear' : 'solar:alt-arrow-down-linear'}
                    size={14}
                    className="opacity-60"
                  />
                }
              />
              {isExpanded && (
                <div className="flex flex-col gap-1 pl-4 border-l border-[var(--line-faint)] ml-4">
                  {it.submenu!.map((leaf) => {
                    const showCategory = leaf.category && leaf.category !== lastCategory;
                    lastCategory = leaf.category;
                    const leafActive = active && activeSubKey === leaf.key;
                    return (
                      <div key={leaf.key} className="flex flex-col gap-1">
                        {showCategory && (
                          <span className="text-[9.5px] font-bold text-[var(--ink-muted)] tracking-wider px-2 pt-2 uppercase">
                            {leaf.category}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => onNavigateSub?.(it.key, leaf.key)}
                          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-left transition-colors ${
                            leafActive
                              ? 'text-[var(--accent)] font-semibold bg-[var(--accent-a10)]'
                              : 'text-[var(--ink-muted)] hover:text-[var(--ink-main)]'
                          }`}
                        >
                          {leaf.icon && <Icon icon={leaf.icon} size={14} />}
                          <span className="truncate">{leaf.label}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          );
        })}
      </nav>

      {/* children (e.g. ProcessingLog) */}
      {children && <div className="mt-auto mb-3">{children}</div>}

      {/* footer / profile */}
      {footer ? (
        <div className={children ? 'mt-3' : 'mt-auto'}>
          <Divider variant="subtle" />
          <div className="pt-4">{footer}</div>
        </div>
      ) : repoScope ? (
        <div className={`rounded-lg border border-[var(--line)] bg-[rgb(26_31_43_/_0.6)] ${children ? 'mt-0' : 'mt-auto'}`}>
          <SideNavItem
            label={repoScope.label}
            icon={<Icon icon="solar:folder-with-files-linear" size={16} className="text-[var(--accent)] opacity-80" />}
            endContent={<Icon icon="solar:alt-arrow-down-linear" size={14} className="opacity-50" />}
            onClick={repoScope.onClick}
          />
        </div>
      ) : null}
    </div>
  );
}

export const Sidebar = memo(SidebarImpl);
