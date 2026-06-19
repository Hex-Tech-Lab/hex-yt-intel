'use client';

import { startTransition } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';

interface ConsoleTabSwitcherProps {
  activeTab: 'synthesis' | 'graph';
  hasGraph: boolean;
  onTabChange: (tab: 'synthesis' | 'graph') => void;
}

const TABS = [
  { key: 'synthesis' as const, label: 'Synthesis', icon: 'solar:widget-5-linear', disabled: false },
  { key: 'graph' as const, label: 'Knowledge Graph', icon: 'solar:share-circle-linear' },
] as const;

export function ConsoleTabSwitcher({ activeTab, hasGraph, onTabChange }: ConsoleTabSwitcherProps) {
  return (
    <div className="flex gap-1 p-1 rounded-xl border border-[var(--line)] bg-[rgb(11_14_20_/_0.5)] self-start">
      {TABS.map((t) => {
        const active = activeTab === t.key;
        const disabled = t.key === 'graph' && !hasGraph;
        return (
          <button
            key={t.key}
            disabled={disabled}
            onClick={() => startTransition(() => onTabChange(t.key))}
            title={disabled ? 'Available once dimensions are synthesized' : undefined}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-none cursor-pointer font-mono text-[10px] font-bold uppercase tracking-wider transition-all ${
              active ? 'bg-[var(--accent)] text-[var(--void)] shadow-lg' : 'bg-transparent text-[var(--ink-muted)] hover:text-[var(--ink-secondary)]'
            } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            <Icon icon={t.icon} size={14} />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
