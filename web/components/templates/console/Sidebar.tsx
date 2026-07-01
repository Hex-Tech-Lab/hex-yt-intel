'use client';

import { Icon } from '@/components/templates/_shared/primitives';
import Link from 'next/link';

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

export function Sidebar({ items, activeKey, onNavigate, repoScope, children, footer }: SidebarProps) {
  return (
    <div className="flex flex-col h-full py-6 px-3.5">
      {/* brand */}
      <Link href="/?v=landing" className="group block no-underline">
        <div className="flex items-center gap-2.5 pt-0 px-2.5 pb-8">
          <span className="grid place-items-center w-[30px] h-[30px] rounded-lg bg-[var(--accent-strong)] text-[var(--void)] shadow-[0_4px_12px_var(--accent-glow)]">
            <Icon icon="solar:graph-up-linear" size={18} />
          </span>
          <span 
            className="font-mono text-[15px] font-bold tracking-wide text-[var(--ink)]"
          >
            HEX{"\u00b7"}YT
          </span>
        </div>
      </Link>

      {/* nav */}
      <nav className="flex flex-col gap-1 flex-1">
        {items.map((it) => {
          const active = it.key === activeKey;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => onNavigate(it.key)}
              aria-current={active ? "page" : undefined}
              className={`hx-navitem group flex items-center gap-3 rounded-lg py-2.5 px-3 text-sm font-sans border-none cursor-pointer text-left transition-all duration-[var(--dur-fast)] ${active ? 'bg-[rgb(6_182_212_/_0.10)] text-[var(--ink)] shadow-[inset_0_0_0_1px_rgb(6_182_212_/_0.15)]' : 'bg-transparent text-[var(--ink-secondary)] shadow-none'}`}
            >
              <Icon icon={it.icon} size={18} className={`transition-colors duration-[var(--dur-fast)] ${active ? 'text-[var(--accent)]' : 'text-inherit'}`} />
              <span className={`flex-1 ${active ? 'font-semibold' : 'font-normal'}`}>{it.label}</span>
              {it.badge && (
                <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${active ? 'text-[var(--accent-ink)] bg-[rgb(6_182_212_/_0.1)]' : 'text-[var(--ink-muted)] bg-[rgb(51_65_85_/_0.2)]'}`}>
                  {it.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* children (e.g. ProcessingLog) */}
      {children && <div className="mt-auto mb-3">{children}</div>}

      {/* footer / profile */}
      {footer ? (
        <div className={`border-t border-[var(--line)] pt-4 ${children ? 'mt-3' : 'mt-auto'}`}>
          {footer}
        </div>
      ) : repoScope ? (
        <button
          type="button"
          onClick={repoScope.onClick}
          className={`hx-navitem flex items-center justify-between rounded-lg border border-[var(--line)] bg-[rgb(26_31_43_/_0.6)] py-3 px-3.5 text-xs text-[var(--ink-secondary)] cursor-pointer font-sans transition-all duration-[var(--dur-fast)] ${children ? 'mt-0' : 'mt-auto'}`}
        >
          <span className="flex items-center gap-2.5">
            <Icon icon="solar:folder-with-files-linear" size={16} className="text-[var(--accent)] opacity-80" />
            <span className="font-medium">{repoScope.label}</span>
          </span>
          <Icon icon="solar:alt-arrow-down-linear" size={14} className="opacity-50" />
        </button>
      ) : null}
    </div>
  );
}
