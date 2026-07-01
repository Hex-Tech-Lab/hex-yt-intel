'use client';

import { ReactNode, useState } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';
import { useUIStore } from '@/store/useUIStore';

export interface TopBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit?: () => void;
  onExport?: (format: 'pdf' | 'markdown') => void;
  tier?: string;
  account?: ReactNode;
  hasRightPanel?: boolean;
}

export function TopBar({ search, onSearchChange, onSearchSubmit, onExport, tier, account, hasRightPanel }: TopBarProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const setMobileNav = useUIStore((s) => s.setMobileNav);
  const setMobileRight = useUIStore((s) => s.setMobileRight);

  return (
    <div className="flex items-center gap-2 sm:gap-3 py-3 px-3 sm:px-6">
      {/* Mobile: open the left navigation drawer */}
      <button
        type="button"
        onClick={() => setMobileNav(true)}
        aria-label="Open menu"
        className="xl:hidden grid place-items-center flex-none w-9 h-9 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-secondary)] cursor-pointer"
      >
        <Icon icon="solar:hamburger-menu-linear" size={18} />
      </button>

      <label
        className="flex min-w-0 flex-1 items-center gap-2 max-w-[460px] rounded-lg border border-[var(--line)] bg-[rgb(26_31_43_/_0.6)] py-2 px-3"
      >
        <Icon icon="solar:magnifer-linear" size={16} className="text-[var(--ink-muted)]" />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onSearchSubmit?.(); }}
          placeholder="Search your knowledge graph"
          aria-label="Search syntheses"
          className="hx-field min-w-0 flex-1 bg-transparent border-none outline-none text-[var(--ink)] font-sans text-[13.5px]"
        />
        <kbd className="hidden sm:block font-mono text-[10px] text-[var(--ink-muted)] border border-[var(--line)] rounded px-1.5 py-0.5">
          ⌘K
        </kbd>
      </label>

      <span className="flex-1" />

      <div className="relative">
        <button
          onClick={() => setExportOpen(!exportOpen)}
          className="hx-navitem flex items-center gap-1.5 py-1.5 px-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-secondary)] cursor-pointer text-xs font-mono transition-all duration-200"
        >
          <Icon icon="solar:download-minimalistic-linear" size={14} />
          Export
          <Icon icon="solar:alt-arrow-down-linear" size={12} className={`transition-transform duration-200 ${exportOpen ? 'rotate-180' : ''}`} />
        </button>

        {exportOpen && (
          <>
            <div 
              className="fixed inset-0 z-40"
              onClick={() => setExportOpen(false)}
            />
            <div 
              className="hx-rise absolute top-[calc(100%_+_8px)] right-0 w-40 bg-[var(--surface-raised)] border border-[var(--line-strong)] rounded-xl p-1 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.5)] z-50 flex flex-col gap-0.5"
            >
              <button
                onClick={() => { onExport?.('pdf'); setExportOpen(false); }}
                className="flex items-center gap-2 w-full py-2 px-2.5 rounded-md border-none bg-transparent text-[var(--ink-secondary)] cursor-pointer text-xs font-mono text-left transition-all duration-200 hover:bg-[var(--line-faint)]"
              >
                <Icon icon="solar:file-text-linear" size={14} />
                Export as PDF
              </button>
              <button
                onClick={() => { onExport?.('markdown'); setExportOpen(false); }}
                className="flex items-center gap-2 w-full py-2 px-2.5 rounded-md border-none bg-transparent text-[var(--ink-secondary)] cursor-pointer text-xs font-mono text-left transition-all duration-200 hover:bg-[var(--line-faint)]"
              >
                <Icon icon="solar:document-text-linear" size={14} />
                Export as Markdown
              </button>
            </div>
          </>
        )}
      </div>

      {tier && (
        <span
          className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-[rgb(6_182_212_/_0.3)] bg-[rgb(6_182_212_/_0.10)] py-1 px-[11px] font-mono text-[11px] font-semibold tracking-wider text-[var(--accent-ink)]"
        >
          <Icon icon="solar:crown-minimalistic-linear" size={12} />
          {tier.toUpperCase()}
        </span>
      )}

      {account || (
        <span
          className="grid place-items-center w-8 h-8 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-secondary)] cursor-pointer"
        >
          <Icon icon="solar:user-linear" size={16} />
        </span>
      )}

      {/* Mobile: open the right intelligence panel drawer */}
      {hasRightPanel && (
        <button
          type="button"
          onClick={() => setMobileRight(true)}
          aria-label="Open intelligence panel"
          className="xl:hidden grid place-items-center flex-none w-9 h-9 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-secondary)] cursor-pointer"
        >
          <Icon icon="solar:widget-linear" size={18} />
        </button>
      )}
    </div>
  );
}
