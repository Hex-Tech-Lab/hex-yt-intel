'use client';

import { startTransition } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';
import { TabList, Tab } from '@astryxdesign/core';

interface ConsoleTabSwitcherProps {
  activeTab: 'synthesis' | 'graph';
  hasGraph: boolean;
  onTabChange: (tab: 'synthesis' | 'graph') => void;
}

const TABS = [
  { key: 'synthesis' as const, label: 'Synthesis', icon: 'solar:widget-5-linear' },
  { key: 'graph' as const, label: 'Knowledge Graph', icon: 'solar:share-circle-linear' },
] as const;

// Astryx's <Tab> has no built-in `disabled`/`title` (BaseProps omits `title`
// as a footgun, and Tab doesn't expose a disabled variant) — the "Knowledge
// Graph" tab needs both while `!hasGraph`, so disabling is emulated here:
// aria-disabled + an onClick guard that swallows the select instead of
// calling through to TabList's onChange, plus a relabeled aria-label in
// place of the old title tooltip.
export function ConsoleTabSwitcher({ activeTab, hasGraph, onTabChange }: ConsoleTabSwitcherProps) {
  return (
    <TabList
      value={activeTab}
      onChange={(value) => startTransition(() => onTabChange(value as 'synthesis' | 'graph'))}
      className="self-start"
    >
      {TABS.map((t) => {
        const disabled = t.key === 'graph' && !hasGraph;
        return (
          <Tab
            key={t.key}
            value={t.key}
            label={disabled ? `${t.label} (available once dimensions are synthesized)` : t.label}
            icon={<Icon icon={t.icon} size={14} />}
            aria-disabled={disabled || undefined}
            onClick={disabled ? (e: React.MouseEvent) => e.preventDefault() : undefined}
          />
        );
      })}
    </TabList>
  );
}
