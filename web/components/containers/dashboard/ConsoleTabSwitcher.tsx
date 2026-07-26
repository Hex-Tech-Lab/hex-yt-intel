'use client';

import { startTransition } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';
import { TabList, Tab } from '@astryxdesign/core';

interface ConsoleTabSwitcherProps {
  activeTab: 'synthesis' | 'graph';
  hasGraph?: boolean;
  onTabChange: (tab: 'synthesis' | 'graph') => void;
}

const TABS = [
  { key: 'synthesis' as const, label: 'Synthesis', icon: 'solar:widget-5-linear' },
  { key: 'graph' as const, label: 'Knowledge Graph', icon: 'solar:share-circle-linear' },
] as const;

// Previously the graph tab was aria-disabled + onClick-guarded while
// !hasGraph, but hasGraph could read stale/false even once nodes existed,
// silently blocking legitimate clicks (2026-07-26 user report: tab didn't
// switch at all). Always allow the switch now; KnowledgeGraphCanvas renders
// its own "still extracting" empty state when there's genuinely no data yet.
export function ConsoleTabSwitcher({ activeTab, onTabChange }: ConsoleTabSwitcherProps) {
  return (
    <TabList
      value={activeTab}
      onChange={(value) => startTransition(() => onTabChange(value as 'synthesis' | 'graph'))}
      className="self-start"
    >
      {TABS.map((t) => (
        <Tab
          key={t.key}
          value={t.key}
          label={t.label}
          icon={<Icon icon={t.icon} size={14} />}
        />
      ))}
    </TabList>
  );
}
