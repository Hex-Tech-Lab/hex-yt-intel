'use client';

import { memo } from 'react';
import Link from 'next/link';
import { SideNavHeading, SideNavItem, NavIcon, Badge, Divider } from '@astryxdesign/core';
import { Icon } from '@/components/templates/_shared/primitives';

export interface SidebarItem {
  key: string;
  label: string;
  icon: string;
  badge?: string;
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
}

function SidebarImpl({ items, activeKey, onNavigate, repoScope, children, footer }: SidebarProps) {
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
        {items.map((it) => {
          const active = it.key === activeKey;
          return (
            <SideNavItem
              key={it.key}
              label={it.label}
              icon={<Icon icon={it.icon} size={18} />}
              isSelected={active}
              onClick={() => onNavigate(it.key)}
              endContent={it.badge ? <Badge variant={active ? 'cyan' : 'neutral'} label={it.badge} /> : undefined}
            />
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
