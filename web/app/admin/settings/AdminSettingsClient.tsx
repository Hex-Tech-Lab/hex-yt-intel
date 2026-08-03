'use client';

import { useEffect, useMemo, useState } from 'react';
import { Banner, Spinner, Card, Button, Badge } from '@astryxdesign/core';
import type { AdminSettingRow } from '@/app/api/admin/settings/route';

const SUBMENU_LABELS: Record<string, string> = {
  cascade: 'LLM Cascades',
  chat: 'Chat',
  comments: 'Comments',
  kg: 'Knowledge Graph',
};

function submenuOf(key: string): string {
  return key.split('.')[0] ?? 'other';
}

function submenuLabel(prefix: string): string {
  return SUBMENU_LABELS[prefix] ?? prefix;
}

export function AdminSettingsClient() {
  const [settings, setSettings] = useState<AdminSettingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/settings')
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
        return res.json();
      })
      .then((data: { settings: AdminSettingRow[] }) => {
        setSettings(data.settings);
        setActiveMenu((prev) => prev ?? submenuOf(data.settings[0]?.key ?? 'other'));
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const menus = useMemo(() => {
    if (!settings) return [];
    const set = new Set(settings.map((s) => submenuOf(s.key)));
    return Array.from(set).sort();
  }, [settings]);

  const visible = useMemo(() => {
    if (!settings || !activeMenu) return [];
    return settings.filter((s) => submenuOf(s.key) === activeMenu);
  }, [settings, activeMenu]);

  const draftFor = (row: AdminSettingRow) => drafts[row.key] ?? JSON.stringify(row.value, null, 2);

  const save = async (row: AdminSettingRow) => {
    setSaveError((prev) => ({ ...prev, [row.key]: '' }));
    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(draftFor(row));
    } catch {
      setSaveError((prev) => ({ ...prev, [row.key]: 'Invalid JSON' }));
      return;
    }
    setSavingKey(row.key);
    try {
      const res = await fetch(`/api/admin/settings/${encodeURIComponent(row.key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: parsedValue }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setSettings((prev) => prev?.map((s) => (s.key === row.key ? { ...s, value: parsedValue, isOverridden: true } : s)) ?? prev);
      setSavedKey(row.key);
      setTimeout(() => setSavedKey((k) => (k === row.key ? null : k)), 2000);
    } catch (err) {
      setSaveError((prev) => ({ ...prev, [row.key]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setSavingKey(null);
    }
  };

  if (error) {
    return (
      <div className="p-8">
        <Banner status="error" title={`Failed to load settings: ${error}`} />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="p-8 flex items-center gap-3 font-mono text-sm text-[var(--ink-secondary)]">
        <Spinner size="sm" />
        <span>Loading settings…</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[var(--bg)]">
      <nav className="w-56 flex-none border-r border-[var(--line)] p-4">
        <h1 className="font-mono text-xs uppercase tracking-wide text-[var(--ink-muted)] mb-4">System Settings</h1>
        <ul className="space-y-1">
          {menus.map((menu) => (
            <li key={menu}>
              <Button
                variant={activeMenu === menu ? "primary" : "ghost"}
                label={submenuLabel(menu)}
                onClick={() => setActiveMenu(menu)}
                width="100%"
                style={{ justifyContent: 'flex-start' }}
              />
            </li>
          ))}
        </ul>
      </nav>

      <main className="flex-1 p-8 space-y-6 max-w-3xl">
        <h2 className="text-lg font-semibold text-[var(--ink)]">{activeMenu ? submenuLabel(activeMenu) : ''}</h2>
        {visible.map((row) => (
          <Card key={row.key} padding={4}>
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="font-mono text-sm text-[var(--ink)]">{row.key}</span>
              <div className="flex items-center gap-2">
                {row.isOverridden && (
                  <Badge variant="info" label="overridden" />
                )}
                <Badge variant="neutral" label={row.dataType} />
              </div>
            </div>
            <p className="text-xs text-[var(--ink-secondary)] mb-3">{row.description}</p>
            <textarea
              className="w-full min-h-[80px] font-mono text-xs bg-[var(--bg)] border border-[var(--line)] rounded-md p-2 text-[var(--ink)]"
              value={draftFor(row)}
              onChange={(e) => setDrafts((prev) => ({ ...prev, [row.key]: e.target.value }))}
              spellCheck={false}
            />
            {saveError[row.key] && (
              <p className="text-xs text-[var(--err)] mt-1">{saveError[row.key]}</p>
            )}
            <div className="flex items-center gap-3 mt-2">
              <Button
                variant="primary"
                label={savingKey === row.key ? 'Saving…' : 'Save'}
                isLoading={savingKey === row.key}
                isDisabled={savingKey === row.key}
                onClick={() => save(row)}
              />
              {savedKey === row.key && <span className="text-xs text-[var(--ok)] font-mono">Saved</span>}
              <span className="text-[10px] font-mono text-[var(--ink-muted)]">updated {new Date(row.updatedAt).toLocaleString()}</span>
            </div>
          </Card>
        ))}
      </main>
    </div>
  );
}
