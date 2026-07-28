'use client';

import { useState, useEffect, useCallback } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';
import { IconButton, Tooltip } from '@astryxdesign/core';

type LogTabKey = 'synthesis' | 'qstash' | 'upstash-redis' | 'upstash-vector' | 'vercel' | 'supabase' | 'worker' | 'openrouter';
type TimeRangeKey = '30m' | '1h' | 'today' | 'custom';

interface TabConfig {
  key: LogTabKey;
  label: string;
  isLive: boolean;
  endpoint?: string;
  reason?: string;
  helpText?: string;
  /** Tab has a QStash-polled snapshot history table (upstash_snapshots) to show. */
  hasHistory?: boolean;
}

interface SnapshotHistoryRow {
  polledAt: string;
  ok: boolean;
  stats: Record<string, unknown>;
  error: string | null;
}

const TABS: TabConfig[] = [
  {
    key: 'synthesis',
    label: 'Synthesis Log',
    isLive: true,
    endpoint: '/api/admin/logs/synthesis',
    helpText: 'Live fetch: In-app synthesis executions and comment sampling runs from Supabase DB.',
  },
  {
    key: 'qstash',
    label: 'Upstash QStash',
    isLive: true,
    endpoint: '/api/admin/logs/qstash',
    helpText: 'Live fetch: Upstash QStash event log history via QSTASH_TOKEN REST API.',
  },
  {
    key: 'upstash-redis',
    label: 'Upstash Redis',
    isLive: true,
    endpoint: '/api/admin/logs/upstash-redis',
    helpText: 'Live fetch: Telemetry and database info metrics via UPSTASH_REDIS_REST_URL. History below is polled every 15 min by QStash and stored in upstash_snapshots.',
    hasHistory: true,
  },
  {
    key: 'upstash-vector',
    label: 'Upstash Vector',
    isLive: true,
    endpoint: '/api/admin/logs/upstash-vector',
    helpText: 'Live fetch: Index telemetry and dimension vector counts via UPSTASH_VECTOR_REST_URL. History below is polled every 15 min by QStash and stored in upstash_snapshots.',
    hasHistory: true,
  },
  {
    key: 'vercel',
    label: 'Vercel',
    isLive: true,
    endpoint: '/api/admin/logs/vercel',
    reason: 'Requires VERCEL_TOKEN and VERCEL_PROJECT_ID environment variables in production.',
    helpText: 'Live fetch (when configured) or paste Vercel dashboard runtime logs below.',
  },
  {
    key: 'supabase',
    label: 'Supabase Engine',
    isLive: true,
    endpoint: '/api/admin/logs/supabase',
    reason: 'Requires SUPABASE_ACCESS_TOKEN for Supabase Management API.',
    helpText: 'Live fetch (when configured) or paste Supabase database logs below.',
  },
  {
    key: 'worker',
    label: 'Cloudflare Worker',
    isLive: true,
    endpoint: '/api/admin/logs/cloudflare',
    reason: 'Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in environment variables.',
    helpText: 'Live fetch (when configured) or paste Cloudflare analytics log output below.',
  },
  {
    key: 'openrouter',
    label: 'OpenRouter',
    isLive: false,
    reason: 'OpenRouter API has no bulk log export endpoint (Dashboard paste-in only).',
    helpText: 'Paste OpenRouter dashboard generation or activity logs below.',
  },
];

interface LogRow {
  timestamp: string;
  level: string;
  source: string;
  message: string;
}

function parseLogLine(line: string): LogRow {
  const timeMatch = line.match(/^\[(.*?)\]\s*\[(.*?)\]\s*\[(.*?)\]\s*(.*)$/);
  if (timeMatch) {
    return {
      timestamp: timeMatch[1] || '',
      level: timeMatch[2] || 'INFO',
      source: timeMatch[3] || 'app',
      message: timeMatch[4] || '',
    };
  }
  return {
    timestamp: new Date().toISOString(),
    level: 'INFO',
    source: 'log',
    message: line,
  };
}

export function LogsViewerClient() {
  const [activeTab, setActiveTab] = useState<LogTabKey>('synthesis');
  const [timeRange, setTimeRange] = useState<TimeRangeKey>('1h');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');

  const [tabLogs, setTabLogs] = useState<Record<LogTabKey, string>>({
    synthesis: 'Loading synthesis logs…',
    qstash: 'Loading QStash logs…',
    'upstash-redis': 'Loading Redis telemetry…',
    'upstash-vector': 'Loading Vector index telemetry…',
    vercel: '',
    supabase: '',
    worker: '',
    openrouter: '',
  });

  const [loading, setLoading] = useState<boolean>(false);
  const [historyByTab, setHistoryByTab] = useState<Partial<Record<LogTabKey, SnapshotHistoryRow[]>>>({});
  const [showHistory, setShowHistory] = useState<boolean>(false);

  const fetchTabLogs = useCallback(async (tab: TabConfig) => {
    if (!tab.endpoint) return;
    setLoading(true);
    try {
      let url = `${tab.endpoint}?range=${timeRange}`;
      if (timeRange === 'custom' && customStart) url += `&start=${encodeURIComponent(customStart)}`;
      if (timeRange === 'custom' && customEnd) url += `&end=${encodeURIComponent(customEnd)}`;
      if (tab.hasHistory) url += `&history=1`;

      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTabLogs((prev) => ({
          ...prev,
          [tab.key]: `[ERROR] ${data.error || `HTTP ${res.status}`}`,
        }));
      } else {
        setTabLogs((prev) => ({
          ...prev,
          [tab.key]: data.logs || 'No log data returned.',
        }));
        if (tab.hasHistory) {
          setHistoryByTab((prev) => ({ ...prev, [tab.key]: data.history || [] }));
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTabLogs((prev) => ({ ...prev, [tab.key]: `[ERROR] ${msg}` }));
    } finally {
      setLoading(false);
    }
  }, [timeRange, customStart, customEnd]);

  const currentTabConfig = TABS.find((t) => t.key === activeTab)!;

  useEffect(() => {
    if (currentTabConfig.isLive && currentTabConfig.endpoint) {
      fetchTabLogs(currentTabConfig);
    }
  }, [activeTab, timeRange, customStart, customEnd, fetchTabLogs, currentTabConfig]);

  const handlePasteChange = (tab: LogTabKey, value: string) => {
    setTabLogs((prev) => ({ ...prev, [tab]: value }));
  };

  const [copiedTabKey, setCopiedTabKey] = useState<LogTabKey | null>(null);
  const [copiedAll, setCopiedAll] = useState<boolean>(false);

  const copyTabLogs = (tabKey: LogTabKey) => {
    const text = tabLogs[tabKey] || '';
    if (!text.trim()) return;
    navigator.clipboard.writeText(text);
    setCopiedTabKey(tabKey);
    setTimeout(() => setCopiedTabKey(null), 2000);
  };

  const copyAllLogs = async () => {
    const fetchedLogs: Record<string, string> = { ...tabLogs };
    await Promise.all(
      TABS.map(async (tab) => {
        if (tab.isLive && tab.endpoint && !fetchedLogs[tab.key]) {
          try {
            const query = timeRange === 'custom' && customStart && customEnd
              ? `?startTime=${encodeURIComponent(customStart)}&endTime=${encodeURIComponent(customEnd)}`
              : `?range=${timeRange}`;
            const res = await fetch(`${tab.endpoint}${query}`);
            if (res.ok) {
              const data = await res.json();
              fetchedLogs[tab.key] = data.logs || 'No log data returned.';
            }
          } catch (err) {
            console.error('[copyAllLogs] Failed fetching tab logs for', tab.key, err);
          }
        }
      })
    );
    setTabLogs(fetchedLogs);

    const sections: string[] = [];
    TABS.forEach((tab) => {
      const content = (fetchedLogs[tab.key] || '').trim();
      sections.push(`=== ${tab.label.toUpperCase()} ===\n${content || '(No log data)'}`);
    });
    navigator.clipboard.writeText(sections.join('\n\n'));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const rawContent = tabLogs[activeTab] || '';
  const logRows: LogRow[] = rawContent
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map(parseLogLine);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto font-mono text-sm text-[var(--ink-main)]">
      {/* Header & Copy All */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border-muted)] pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--ink-main)]">System Logs & Multi-Provider Telemetry</h1>
          <p className="text-xs text-[var(--ink-muted)] mt-1">
            Live telemetry and log assembly across Synthesis, QStash, Upstash Redis, Upstash Vector, Vercel, Supabase, Cloudflare Workers, and OpenRouter.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip content="Copy all tabs as markdown text">
            <IconButton
              label="Copy all tabs"
              variant="ghost"
              size="sm"
              icon={<Icon icon={copiedAll ? 'solar:check-read-linear' : 'solar:copy-linear'} size={15} />}
              onClick={copyAllLogs}
              className={copiedAll ? '!border-[var(--accent)] !text-[var(--accent)] !bg-[var(--accent-a10)]' : ''}
            />
          </Tooltip>
          <Tooltip content={`Copy ${currentTabConfig.label} logs`}>
            <IconButton
              label={`Copy ${currentTabConfig.label} logs`}
              variant="ghost"
              size="sm"
              icon={<Icon icon={copiedTabKey === activeTab ? 'solar:check-read-linear' : 'solar:copy-linear'} size={15} />}
              onClick={() => copyTabLogs(activeTab)}
              className={copiedTabKey === activeTab ? '!border-[var(--accent)] !text-[var(--accent)] !bg-[var(--accent-a10)]' : ''}
            />
          </Tooltip>
        </div>
      </div>

      {/* Provider Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-muted)] pb-2">
        {TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                isActive
                  ? 'bg-[var(--accent-a10)] text-[var(--accent)] border border-[var(--accent)]'
                  : 'bg-[var(--surface)] text-[var(--ink-muted)] hover:text-[var(--ink-main)] border border-[var(--border-muted)]'
              }`}
            >
              {tab.label}
              {!tab.isLive && <span className="ml-1.5 text-[10px] opacity-60">(paste)</span>}
            </button>
          );
        })}
      </div>

      {/* Time Range Selector for Live Tabs */}
      {currentTabConfig.isLive && (
        <div className="flex flex-wrap items-center justify-between gap-4 bg-[var(--surface)] p-3 rounded-lg border border-[var(--border-muted)]">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--ink-muted)] font-semibold">Time Window:</span>
            {(['30m', '1h', 'today', 'custom'] as TimeRangeKey[]).map((r) => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={`px-2.5 py-1 rounded text-xs ${
                  timeRange === r
                    ? 'bg-[var(--accent)] text-black font-bold'
                    : 'bg-[var(--surface-raised)] text-[var(--ink-muted)] hover:text-[var(--ink-main)]'
                }`}
              >
                {r === '30m' ? 'Last 30m' : r === '1h' ? 'Last 1h' : r === 'today' ? 'Today' : 'Custom'}
              </button>
            ))}
          </div>

          {timeRange === 'custom' && (
            <div className="flex items-center gap-2 text-xs">
              <input
                type="datetime-local"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="bg-[var(--bg)] border border-[var(--border-muted)] p-1 rounded text-[var(--ink-main)]"
              />
              <span>to</span>
              <input
                type="datetime-local"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="bg-[var(--bg)] border border-[var(--border-muted)] p-1 rounded text-[var(--ink-main)]"
              />
            </div>
          )}
        </div>
      )}

      {/* Help/Reason Header */}
      {currentTabConfig.helpText && (
        <p className="text-xs text-[var(--ink-muted)] italic">{currentTabConfig.helpText}</p>
      )}

      {/* Structured Log Table / Output Area */}
      <div className="border border-[var(--border-muted)] rounded-lg overflow-hidden bg-[var(--surface)]">
        {loading ? (
          <div className="p-8 text-center text-xs text-[var(--accent)] animate-pulse font-mono">
            Fetching live {currentTabConfig.label} telemetry…
          </div>
        ) : !currentTabConfig.isLive ? (
          <div className="p-4 flex flex-col gap-3">
            {currentTabConfig.reason && (
              <div className="text-xs p-2.5 rounded bg-[var(--accent-a10)] border border-[var(--accent)] text-[var(--ink-main)]">
                {currentTabConfig.reason}
              </div>
            )}
            <textarea
              rows={16}
              value={tabLogs[activeTab] || ''}
              onChange={(e) => handlePasteChange(activeTab, e.target.value)}
              placeholder={`Paste raw ${currentTabConfig.label} log export here…`}
              className="w-full bg-[var(--bg)] border border-[var(--border-muted)] rounded p-3 text-xs font-mono text-[var(--ink-main)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
        ) : logRows.length === 0 ? (
          <div className="p-8 text-center text-xs text-[var(--ink-muted)] font-mono">
            No telemetry rows in selected window.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[var(--surface-raised)] border-b border-[var(--border-muted)] text-[var(--ink-muted)] font-semibold">
                  <th className="py-2.5 px-3 w-[190px]">Timestamp</th>
                  <th className="py-2.5 px-3 w-[90px]">Level</th>
                  <th className="py-2.5 px-3 w-[150px]">Source</th>
                  <th className="py-2.5 px-3">Message / Payload</th>
                </tr>
              </thead>
              <tbody>
                {logRows.map((row, idx) => {
                  const isErr = row.level.includes('ERR');
                  const isWarn = row.level.includes('WARN') || row.message.includes('synthesis:FAILED') || row.message.includes('valid=false');
                  return (
                    <tr
                      key={idx}
                      className={`border-b border-[var(--border-muted)]/50 transition-colors ${
                        isWarn ? 'bg-[var(--warn)]/10 text-[var(--warn)] shadow-[0_0_10px_rgba(245,158,11,0.15)]' :
                        isErr ? 'bg-[var(--err)]/10 text-[var(--err)]' :
                        idx % 2 === 0 ? 'bg-transparent' : 'bg-[var(--surface-raised)]/30'
                      }`}
                    >
                      <td className="py-2 px-3 whitespace-nowrap text-[var(--ink-muted)]">{row.timestamp}</td>
                      <td className="py-2 px-3 font-bold">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                          isErr ? 'bg-red-950 text-red-400 border border-red-800' :
                          isWarn ? 'bg-[var(--warn)]/20 text-[var(--warn)] border border-[var(--warn)]/60' :
                          'bg-cyan-950 text-cyan-400 border border-cyan-800'
                        }`}>
                          {row.level}
                        </span>
                      </td>
                      <td className="py-2 px-3 font-semibold text-[var(--accent)]">{row.source}</td>
                      <td className="py-2 px-3 font-mono break-all leading-relaxed">{row.message}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Snapshot History (Upstash Redis/Vector only): 15-min QStash-polled trend */}
      {currentTabConfig.hasHistory && (
        <div className="border border-[var(--border-muted)] rounded-lg overflow-hidden bg-[var(--surface)]">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold text-[var(--ink-muted)] hover:text-[var(--ink-main)] bg-[var(--surface-raised)]"
          >
            <span>
              Snapshot History ({(historyByTab[activeTab] || []).length} polls, every 15 min)
            </span>
            <span>{showHistory ? '▲' : '▼'}</span>
          </button>
          {showHistory && (
            (historyByTab[activeTab] || []).length === 0 ? (
              <div className="p-4 text-center text-xs text-[var(--ink-muted)]">
                No polled snapshots yet.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[var(--surface-raised)] border-b border-[var(--border-muted)] text-[var(--ink-muted)] font-semibold">
                      <th className="py-2 px-3 w-[190px]">Polled At</th>
                      <th className="py-2 px-3 w-[70px]">Status</th>
                      <th className="py-2 px-3">Stats / Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(historyByTab[activeTab] || []).map((row, idx) => (
                      <tr
                        key={`${row.polledAt}-${idx}`}
                        className={`border-b border-[var(--border-muted)]/50 ${!row.ok ? 'bg-[var(--err)]/10 text-[var(--err)]' : idx % 2 === 0 ? 'bg-transparent' : 'bg-[var(--surface-raised)]/30'}`}
                      >
                        <td className="py-2 px-3 whitespace-nowrap text-[var(--ink-muted)]">{row.polledAt}</td>
                        <td className="py-2 px-3 font-bold">{row.ok ? 'OK' : 'FAIL'}</td>
                        <td className="py-2 px-3 font-mono break-all">
                          {row.ok ? JSON.stringify(row.stats) : row.error}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
