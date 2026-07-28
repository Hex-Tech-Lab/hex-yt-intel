'use client';

import { useState, useEffect, startTransition, ViewTransition } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';
import { LogsViewerClient } from '@/app/settings/logs/LogsViewerClient';
import { AdminSettingsClient } from '@/app/admin/settings/AdminSettingsClient';

interface UsageSummary {
  tier: string;
  analyses: { used: number; quota: number | null };
  chatTurns: { synthesisConsole: number; atlas: number; total: number };
  estimatedCostUsd: number;
}

/** Activity & Usage pane -- fetches the real per-user summary from
 *  /api/usage/summary (own-user-only, already computes this from usage_logs)
 *  instead of hardcoding placeholder numbers. */
function UsagePane() {
  const [data, setData] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/usage/summary')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => { if (!cancelled) setData(json); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => {
        // Guaranteed cleanup block
      });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return <p className="text-xs text-[var(--err)]">Failed to load usage summary: {error}</p>;
  }
  if (!data) {
    return <p className="text-xs text-[var(--ink-muted)]">Loading usage summary…</p>;
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border-muted)]">
          <span className="text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">Analyses this month</span>
          <p className="text-xl font-bold text-[var(--accent)] mt-1">
            {data.analyses.used}{data.analyses.quota !== null ? ` / ${data.analyses.quota}` : ' / Unlimited'}
          </p>
        </div>
        <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border-muted)]">
          <span className="text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">Plan</span>
          <p className="text-xl font-bold text-[var(--ink-main)] mt-1 capitalize">{data.tier}</p>
        </div>
        <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border-muted)]">
          <span className="text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">Chat turns</span>
          <p className="text-xl font-bold text-[var(--ink-main)] mt-1">{data.chatTurns.total}</p>
          <p className="text-[10px] text-[var(--ink-muted)] mt-1">
            {data.chatTurns.synthesisConsole} console · {data.chatTurns.atlas} atlas
          </p>
        </div>
        <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border-muted)]">
          <span className="text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">Est. cost this month</span>
          <p className="text-xl font-bold text-[var(--ink-main)] mt-1">${data.estimatedCostUsd.toFixed(4)}</p>
        </div>
      </div>
    </div>
  );
}

export type SettingsSubmenuKey = 'overview' | 'logs' | 'usage' | 'preferences' | 'admin-settings';

export interface SettingsItem {
  key: SettingsSubmenuKey;
  label: string;
  description: string;
  icon: string;
  category: 'TELEMETRY & OBSERVABILITY' | 'ACCOUNT & USAGE' | 'SYSTEM REGISTRY';
}

export const SETTINGS_TREE: SettingsItem[] = [
  {
    key: 'logs',
    label: 'System Logs',
    description: 'Live telemetry across Synthesis, QStash, Upstash, Vercel, Supabase, and CF Workers',
    icon: 'solar:folder-with-files-linear',
    category: 'TELEMETRY & OBSERVABILITY',
  },
  {
    key: 'usage',
    label: 'Activity & Usage',
    description: 'Token consumption, analysis counts, and billing usage metrics',
    icon: 'solar:chart-2-linear',
    category: 'ACCOUNT & USAGE',
  },
  {
    key: 'preferences',
    label: 'App Preferences',
    description: 'Interface density, theme tokens, and display preferences',
    icon: 'solar:settings-linear',
    category: 'ACCOUNT & USAGE',
  },
  {
    key: 'admin-settings',
    label: 'Admin Registry',
    description: 'System configuration registry keys and runtime overrides',
    icon: 'solar:key-minimalistic-linear',
    category: 'SYSTEM REGISTRY',
  },
];

interface SettingsContentPaneProps {
  activeKey: SettingsSubmenuKey;
  /** Lets the Overview grid (and any future in-content cross-links) jump
   *  directly to another leaf. Optional because standalone hosts that don't
   *  want cross-navigation (e.g. a future read-only embed) can omit it. */
  onNavigate?: (key: SettingsSubmenuKey) => void;
}

/**
 * Content-only pane: renders whichever Settings leaf is active. No tree, no
 * breadcrumb -- those live in the host (either the main left nav's inline
 * submenu, or SettingsPanel's own two-pane shell for the standalone
 * /settings routes). Keeping this split lets both hosts render identical
 * content without duplicating the switch.
 */
export function SettingsContentPane({ activeKey, onNavigate }: SettingsContentPaneProps) {
  const [density, setDensity] = useState<'compact' | 'balanced' | 'spacious'>('balanced');

  const goTo = (key: SettingsSubmenuKey) => {
    if (onNavigate) startTransition(() => onNavigate(key));
  };

  return (
    <ViewTransition
      enter={activeKey === 'overview' ? 'slide-in-left' : 'slide-in-right'}
      exit={activeKey === 'overview' ? 'slide-out-right' : 'slide-out-left'}
      default="none"
    >
      <div key={activeKey}>
        {activeKey === 'overview' && (
          <div className="max-w-4xl mx-auto flex flex-col gap-6">
            <div>
              <h2 className="text-lg font-bold text-[var(--ink-main)] tracking-tight">Settings & System Hub</h2>
              <p className="text-xs text-[var(--ink-muted)] mt-1">
                Select a section from the left navigation tree to view telemetry, usage stats, or registry configurations in place.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {SETTINGS_TREE.map((item) => (
                <div
                  key={item.key}
                  onClick={() => goTo(item.key)}
                  className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--border-muted)] hover:border-[var(--accent)] cursor-pointer transition-all flex flex-col justify-between gap-3 group"
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-[var(--bg)] border border-[var(--border-muted)] text-[var(--accent)] group-hover:border-[var(--accent)]">
                      <Icon icon={item.icon} size={20} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-[var(--ink-main)] group-hover:text-[var(--accent)]">
                        {item.label}
                      </h3>
                      <p className="text-xs text-[var(--ink-muted)] mt-1 leading-relaxed">{item.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-end text-xs text-[var(--accent)] font-semibold gap-1">
                    <span>Open section</span>
                    <Icon icon="solar:alt-arrow-right-linear" size={14} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeKey === 'logs' && <LogsViewerClient />}

        {activeKey === 'usage' && <UsagePane />}

        {activeKey === 'preferences' && (
          <div className="max-w-2xl mx-auto flex flex-col gap-6 p-4 bg-[var(--surface)] border border-[var(--border-muted)] rounded-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[var(--ink-main)]">App Display & Control Density</h2>
              <div className="flex items-center gap-1 bg-[rgb(26_31_43_/_0.6)] border border-[var(--line)] rounded-lg p-0.5">
                {(['compact', 'balanced', 'spacious'] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDensity(d)}
                    className={`px-2.5 py-1 rounded-md text-[10.5px] capitalize transition-colors ${
                      density === d
                        ? 'bg-[var(--accent-a12)] text-[var(--accent-ink)]'
                        : 'text-[var(--ink-muted)] hover:text-[var(--ink-secondary)]'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-[var(--ink-muted)]">
              Configure list padding, visual density, and component defaults across the synthesis console.
            </p>
            <div className="flex items-center justify-between p-3 bg-[var(--bg)] rounded-lg border border-[var(--border-muted)]">
              <span className="text-xs font-semibold">List Spacing Density</span>
              <span className="text-xs capitalize font-bold text-[var(--accent)]">{density}</span>
            </div>
          </div>
        )}

        {activeKey === 'admin-settings' && <AdminSettingsClient />}
      </div>
    </ViewTransition>
  );
}

interface SettingsPanelProps {
  initialSubmenu?: SettingsSubmenuKey;
}

/**
 * Standalone two-pane Settings shell -- still used by the deep-link routes
 * (/settings, /settings/logs) that need a self-contained page rather than
 * the in-dashboard collapsible nav. Renders its own tree + breadcrumb, then
 * delegates content to the shared SettingsContentPane.
 */
export function SettingsPanel({ initialSubmenu = 'overview' }: SettingsPanelProps) {
  const [activeKey, setActiveKey] = useState<SettingsSubmenuKey>(initialSubmenu);
  const [query, setQuery] = useState('');

  const activeItem = SETTINGS_TREE.find((i) => i.key === activeKey);

  const categories = Array.from(new Set(SETTINGS_TREE.map((i) => i.category)));

  return (
    <div className="flex flex-col h-full w-full bg-[var(--bg)] font-mono text-sm text-[var(--ink-main)]">
      {/* Top Persistent Breadcrumb Header / Home Affordance */}
      <div className="flex items-center justify-between py-3 px-6 border-b border-[var(--border-muted)] bg-[rgb(11_14_20_/_0.8)] backdrop-blur-md">
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => setActiveKey('overview')}
            title="Return to Settings Overview"
            className="flex items-center gap-1.5 font-bold text-[var(--accent)] hover:underline cursor-pointer bg-transparent border-none p-0"
          >
            <Icon icon="solar:settings-linear" size={15} />
            <span>{'// SETTINGS'}</span>
          </button>
          {activeItem && (
            <>
              <span className="text-[var(--ink-muted)]">/</span>
              <span className="font-semibold text-[var(--ink-main)]">{activeItem.label}</span>
            </>
          )}
        </div>
      </div>

      {/* Persistent Two-Pane Layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left-Hand Tree Navigation Column */}
        <div className="w-[280px] flex-shrink-0 border-r border-[var(--border-muted)] bg-[var(--surface)]/60 flex flex-col p-4 overflow-y-auto gap-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter submenus..."
            className="w-full bg-[var(--bg)] border border-[var(--border-muted)] rounded-lg px-3 py-1.5 text-xs text-[var(--ink-main)] placeholder:text-[var(--ink-muted)] outline-none focus:border-[var(--accent)]"
          />

          <div className="flex flex-col gap-4">
            <button
              onClick={() => startTransition(() => setActiveKey('overview'))}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-left transition-colors ${
                activeKey === 'overview'
                  ? 'bg-[var(--accent-a10)] text-[var(--accent)] border border-[var(--accent)]'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink-main)] hover:bg-[var(--surface-raised)]'
              }`}
            >
              <Icon icon="solar:home-2-linear" size={16} />
              <span>Overview</span>
            </button>

            {categories.map((cat) => {
              const items = SETTINGS_TREE.filter(
                (i) =>
                  i.category === cat &&
                  (i.label.toLowerCase().includes(query.toLowerCase()) ||
                    i.description.toLowerCase().includes(query.toLowerCase()))
              );
              if (items.length === 0) return null;

              return (
                <div key={cat} className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold text-[var(--ink-muted)] tracking-wider px-2 uppercase">
                    {cat}
                  </span>
                  {items.map((item) => {
                    const isSelected = activeKey === item.key;
                    return (
                      <button
                        key={item.key}
                        onClick={() => startTransition(() => setActiveKey(item.key))}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-left transition-all ${
                          isSelected
                            ? 'bg-[var(--accent-a10)] text-[var(--accent)] border border-[var(--accent)] font-bold'
                            : 'text-[var(--ink-muted)] hover:text-[var(--ink-main)] hover:bg-[var(--surface-raised)] border border-transparent'
                        }`}
                      >
                        <Icon
                          icon={item.icon}
                          size={16}
                          className={isSelected ? 'text-[var(--accent)]' : 'text-[var(--ink-muted)]'}
                        />
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right-Hand Content Pane */}
        <div className="flex-1 overflow-y-auto bg-[var(--bg)] p-4 lg:p-6">
          <SettingsContentPane activeKey={activeKey} onNavigate={setActiveKey} />
        </div>
      </div>
    </div>
  );
}
