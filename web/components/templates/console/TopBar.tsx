'use client';

import { memo, ReactNode, useState } from 'react';
import { IconButton, Badge, Avatar, Button } from '@astryxdesign/core';
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

function TopBarImpl({ search, onSearchChange, onSearchSubmit, onExport, tier, account, hasRightPanel }: TopBarProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const setMobileNav = useUIStore((s) => s.setMobileNav);
  const setMobileRight = useUIStore((s) => s.setMobileRight);

  return (
    <div className="flex items-center gap-2 sm:gap-3 py-3 px-3 sm:px-6">
      {/* Mobile: open the left navigation drawer */}
      <IconButton
        label="Open menu"
        variant="ghost"
        className="xl:hidden flex-none"
        icon={<Icon icon="solar:hamburger-menu-linear" size={18} />}
        onClick={() => setMobileNav(true)}
      />

      {/*
        Search input stays a raw <input> — the same decision already made in
        AnalysisHero.tsx this rollout: astryx's TextInput chrome (border/focus
        ring/padding) clashes with this field's kbd-shortcut affordance and
        icon-inline layout, and there's no lighter-weight text-field primitive.
      */}
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
        <Button
          label="Export"
          variant="ghost"
          size="sm"
          className="font-mono"
          icon={<Icon icon="solar:download-minimalistic-linear" size={14} />}
          endContent={<Icon icon="solar:alt-arrow-down-linear" size={12} className={`transition-transform duration-200 ${exportOpen ? 'rotate-180' : ''}`} />}
          onClick={() => setExportOpen(!exportOpen)}
        />

        {/*
          The dropdown itself (2-item export-format action menu) stays custom:
          astryx's TopNavMenu is a hover-triggered nav-overflow menu built for
          title+description nav items, wrong semantics/interaction model for a
          click-triggered 2-item action list, and there's no lighter-weight
          generic menu/dropdown primitive in the package.
        */}
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
        <span className="hidden sm:inline-flex">
          <Badge
            variant="cyan"
            label={tier.toUpperCase()}
            icon={<Icon icon="solar:crown-minimalistic-linear" size={12} />}
          />
        </span>
      )}

      {account || <Avatar size={32} alt="Account" />}

      {/* Mobile: open the right intelligence panel drawer */}
      {hasRightPanel && (
        <IconButton
          label="Open intelligence panel"
          variant="ghost"
          className="xl:hidden flex-none"
          icon={<Icon icon="solar:widget-linear" size={18} />}
          onClick={() => setMobileRight(true)}
        />
      )}
    </div>
  );
}

export const TopBar = memo(TopBarImpl);
