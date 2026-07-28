'use client';

import { useState, useEffect, useCallback } from 'react';

type LogTabKey = 'synthesis' | 'vercel' | 'supabase' | 'worker' | 'openrouter';
type TimeRangeKey = '30m' | '1h' | 'today' | 'custom';

interface TabConfig {
  key: LogTabKey;
  label: string;
  isLive: boolean;
  reason?: string;
  helpText?: string;
}

const TABS: TabConfig[] = [
  {
    key: 'synthesis',
    label: 'Synthesis Log (In-App)',
    isLive: true,
    helpText: 'Live fetch: In-app synthesis executions and comment sampling runs from Supabase DB.',
  },
  {
    key: 'vercel',
    label: 'Vercel',
    isLive: false,
    reason: 'Missing VERCEL_TOKEN and VERCEL_PROJECT_ID environment variables for server-side API fetch.',
    helpText: 'Paste Vercel dashboard runtime logs JSONL or raw export below.',
  },
  {
    key: 'supabase',
    label: 'Supabase',
    isLive: false,
    reason: 'Missing SUPABASE_ACCESS_TOKEN for Supabase Management API (Postgres engine log download).',
    helpText: 'Paste Supabase dashboard database or auth logs below.',
  },
  {
    key: 'worker',
    label: 'Cloudflare Worker',
    isLive: false,
    reason: 'Missing CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID environment variables.',
    helpText: 'Paste wrangler tail or Cloudflare dashboard log output below.',
  },
  {
    key: 'openrouter',
    label: 'OpenRouter',
    isLive: false,
    reason: 'OpenRouter API provides no bulk text log download endpoint (Dashboard Web UI paste-in required).',
    helpText: 'Paste OpenRouter dashboard generation or activity logs below.',
  },
];

export function LogsViewerClient() {
  const [activeTab, setActiveTab] = useState<LogTabKey>('synthesis');
  const [timeRange, setTimeRange] = useState<TimeRangeKey>('1h');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');

  const [synthesisLogs, setSynthesisLogs] = useState<string>('Loading live synthesis logs…');
  const [loadingSynthesis, setLoadingSynthesis] = useState<boolean>(false);

  const [pastedLogs, setPastedLogs] = useState<Record<LogTabKey, string>>({
    synthesis: '',
    vercel: '',
    supabase: '',
    worker: '',
    openrouter: '',
  });

  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const fetchSynthesisLogs = useCallback(async () => {
    setLoadingSynthesis(true);
    try {
      let url = `/api/admin/logs/synthesis?range=${timeRange}`;
      if (timeRange === 'custom' && customStart) {
        url += `&start=${encodeURIComponent(customStart)}`;
      }
      if (timeRange === 'custom' && customEnd) {
        url += `&end=${encodeURIComponent(customEnd)}`;
      }
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Fetch failed' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSynthesisLogs(data.logs || 'No logs returned.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSynthesisLogs(`[ERROR] ${msg}`);
    } finally {
      setLoadingSynthesis(false);
    }
  }, [timeRange, customStart, customEnd]);

  useEffect(() => {
    fetchSynthesisLogs();
  }, [fetchSynthesisLogs]);

  const handlePasteChange = (tab: LogTabKey, value: string) => {
    setPastedLogs((prev) => ({ ...prev, [tab]: value }));
  };

  const getTabLogContent = (tabKey: LogTabKey): string => {
    if (tabKey === 'synthesis') {
      return synthesisLogs;
    }
    return pastedLogs[tabKey] || '';
  };

  const showTooltip = (msg: string) => {
    setCopyFeedback(msg);
    setTimeout(() => setCopyFeedback(null), 2500);
  };

  const copyTabLogs = (tabKey: LogTabKey) => {
    const text = getTabLogContent(tabKey);
    if (!text.trim()) {
      showTooltip('Tab is empty!');
      return;
    }
    navigator.clipboard.writeText(text);
    showTooltip(`Copied ${TABS.find((t) => t.key === tabKey)?.label} logs!`);
  };

  const copyAllLogs = () => {
    const sections: string[] = [];
    TABS.forEach((tab) => {
      const content = getTabLogContent(tab.key).trim();
      sections.push(`=== ${tab.label.toUpperCase()} ===\n${content || '(No log data)'}`);
    });
    const combined = sections.join('\n\n');
    navigator.clipboard.writeText(combined);
    showTooltip('All tabs copied to clipboard!');
  };

  const currentTabConfig = TABS.find((t) => t.key === activeTab)!;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto font-mono text-sm text-[var(--ink-main)]">
      {/* Header & Copy All */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border-muted)] pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--ink-main)]">System Logs & Traceability</h1>
          <p className="text-xs text-[var(--ink-muted)] mt-1">
            Admin console for multi-provider telemetry, error diagnosis, and time-window log assembly.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {copyFeedback && (
            <span className="text-xs px-2 py-1 bg-[var(--accent-glow)] text-[var(--accent-cyan)] rounded border border-[var(--accent-cyan)] animate-pulse">
              {copyFeedback}
            </span>
          )}
          <button
            onClick={copyAllLogs}
            className="px-4 py-2 bg-[var(--accent-cyan)] hover:opacity-90 text-[var(--bg-main)] font-semibold text-xs rounded transition-colors"
          >
            Copy All Tabs
          </button>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex flex-wrap border-b border-[var(--border-muted)] gap-1">
        {TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 font-medium text-xs rounded-t border-t border-l border-r transition-colors ${
                isActive
                  ? 'bg-[var(--bg-card)] border-[var(--border-muted)] text-[var(--accent-cyan)] border-b-transparent'
                  : 'bg-[var(--bg-muted)] border-transparent text-[var(--ink-muted)] hover:text-[var(--ink-main)]'
              }`}
            >
              <div className="flex items-center gap-2">
                <span>{tab.label}</span>
                <span
                  className={`w-2 h-2 rounded-full ${
                    tab.isLive ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                  title={tab.isLive ? 'Live Fetch' : 'Paste-In'}
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* Time Range Controls */}
      <div className="flex flex-wrap items-center gap-4 bg-[var(--bg-card)] p-3 rounded border border-[var(--border-muted)]">
        <span className="text-xs font-semibold text-[var(--ink-muted)]">Time Window:</span>
        <div className="flex gap-2">
          {(['30m', '1h', 'today', 'custom'] as TimeRangeKey[]).map((r) => (
            <button
              key={r}
              onClick={() => setTimeRange(r)}
              className={`px-3 py-1 text-xs rounded border transition-colors ${
                timeRange === r
                  ? 'bg-[var(--accent-cyan)] text-[var(--bg-main)] border-[var(--accent-cyan)] font-bold'
                  : 'bg-[var(--bg-muted)] text-[var(--ink-muted)] border-[var(--border-muted)] hover:text-[var(--ink-main)]'
              }`}
            >
              {r === '30m' && 'Last 30 Min'}
              {r === '1h' && 'Last 1 Hr'}
              {r === 'today' && 'Today'}
              {r === 'custom' && 'Custom Range'}
            </button>
          ))}
        </div>

        {timeRange === 'custom' && (
          <div className="flex items-center gap-2 ml-auto">
            <input
              type="datetime-local"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="px-2 py-1 text-xs bg-[var(--bg-main)] border border-[var(--border-muted)] rounded text-[var(--ink-main)]"
            />
            <span className="text-xs text-[var(--ink-muted)]">to</span>
            <input
              type="datetime-local"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="px-2 py-1 text-xs bg-[var(--bg-main)] border border-[var(--border-muted)] rounded text-[var(--ink-main)]"
            />
          </div>
        )}

        {currentTabConfig.isLive && (
          <button
            onClick={fetchSynthesisLogs}
            disabled={loadingSynthesis}
            className="ml-auto px-3 py-1 text-xs bg-[var(--bg-muted)] hover:bg-[var(--border-muted)] text-[var(--ink-main)] border border-[var(--border-muted)] rounded transition-colors disabled:opacity-50"
          >
            {loadingSynthesis ? 'Refreshing…' : 'Refresh Live'}
          </button>
        )}
      </div>

      {/* Tab Banner / Help Text */}
      <div className="text-xs px-3 py-2 bg-[var(--bg-muted)] border border-[var(--border-muted)] rounded text-[var(--ink-muted)] flex items-center justify-between">
        <span>{currentTabConfig.helpText}</span>
        {!currentTabConfig.isLive && currentTabConfig.reason && (
          <span className="text-[var(--warn)] font-medium">⚠️ {currentTabConfig.reason}</span>
        )}
      </div>

      {/* Main Content Area */}
      <div className="relative border border-[var(--border-muted)] rounded bg-[var(--bg-card)] p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-[var(--ink-muted)] uppercase tracking-wider">
            {currentTabConfig.label} Content
          </span>
          <button
            onClick={() => copyTabLogs(activeTab)}
            className="px-3 py-1 text-xs bg-[var(--bg-muted)] hover:bg-[var(--border-muted)] text-[var(--ink-main)] border border-[var(--border-muted)] rounded transition-colors"
          >
            Copy {currentTabConfig.label} Logs
          </button>
        </div>

        {currentTabConfig.isLive ? (
          <pre className="w-full h-96 p-3 bg-[var(--bg-main)] border border-[var(--border-muted)] rounded overflow-auto font-mono text-xs text-emerald-400 whitespace-pre-wrap">
            {synthesisLogs}
          </pre>
        ) : (
          <textarea
            value={pastedLogs[activeTab]}
            onChange={(e) => handlePasteChange(activeTab, e.target.value)}
            placeholder={`Paste raw ${currentTabConfig.label} export or JSONL log lines here…`}
            className="w-full h-96 p-3 bg-[var(--bg-main)] border border-[var(--border-muted)] rounded overflow-auto font-mono text-xs text-[var(--ink-main)] focus:outline-none focus:border-[var(--accent-cyan)] resize-y"
          />
        )}
      </div>
    </div>
  );
}
