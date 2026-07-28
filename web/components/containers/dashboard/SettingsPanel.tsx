'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { List, ListItem, type ListDensity } from '@astryxdesign/core/List';
import { Icon } from '@/components/templates/_shared/primitives';

interface SettingsEntry {
  key: string;
  label: string;
  description: string;
  icon: string;
  href: string;
}

const SETTINGS_ENTRIES: SettingsEntry[] = [
  {
    key: 'logs',
    label: 'System Logs',
    description: 'Synthesis, QStash, Upstash Redis, Vercel, Supabase, Cloudflare, and OpenRouter logs',
    icon: 'solar:folder-with-files-linear',
    href: '/settings/logs',
  },
  {
    key: 'usage',
    label: 'Activity & Usage',
    description: 'Analysis usage statistics, model generation counts, and token telemetry',
    icon: 'solar:chart-2-linear',
    href: '/billing',
  },
];

const DENSITY_OPTIONS: { key: ListDensity; label: string }[] = [
  { key: 'compact', label: 'Compact' },
  { key: 'balanced', label: 'Normal' },
  { key: 'spacious', label: 'Lax' },
];

/** Settings landing panel — submenu list for /settings/* pages, rendered inside the dashboard's 'settings' nav tab. */
export function SettingsPanel() {
  const [density, setDensity] = useState<ListDensity>('balanced');
  const [query, setQuery] = useState('');

  const filtered = SETTINGS_ENTRIES.filter((entry) =>
    entry.label.toLowerCase().includes(query.toLowerCase()) ||
    entry.description.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-4 gap-3">
        <h2 className="font-mono text-sm font-semibold text-[var(--ink)] tracking-wide">{'// SETTINGS'}</h2>
        <div className="flex items-center gap-1 bg-[rgb(26_31_43_/_0.6)] border border-[var(--line)] rounded-lg p-0.5">
          {DENSITY_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setDensity(opt.key)}
              className={`px-2.5 py-1 rounded-md font-mono text-[10.5px] transition-colors ${
                density === opt.key
                  ? 'bg-[var(--accent-a12)] text-[var(--accent-ink)]'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink-secondary)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter settings..."
        className="hx-field w-full mb-4 bg-[rgb(11_14_20_/_0.6)] border border-[var(--line)] rounded-lg px-3 py-2 font-mono text-xs text-[var(--ink)] placeholder:text-[var(--ink-muted)] outline-none"
      />

      <List density={density} hasDividers>
        <AnimatePresence mode="popLayout">
          {filtered.map((entry, i) => (
            <motion.div
              key={entry.key}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: 'easeOut', delay: i * 0.03 }}
              className={i % 2 === 1 ? 'bg-[rgb(255_255_255_/_0.02)]' : ''}
            >
              <ListItem
                label={entry.label}
                description={entry.description}
                startContent={<Icon icon={entry.icon} size={18} className="text-[var(--accent-ink)]" />}
                endContent={<Icon icon="solar:alt-arrow-right-linear" size={14} className="text-[var(--ink-muted)]" />}
                href={entry.href}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </List>

      {filtered.length === 0 && (
        <div className="text-center py-8 font-mono text-xs text-[var(--ink-muted)]">
          No settings match &quot;{query}&quot;
        </div>
      )}
    </div>
  );
}
