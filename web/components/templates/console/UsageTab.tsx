'use client';

import { useUsageSummary } from '@/hooks/useUsageSummary';

function UsageRow({ label, used, quota }: { label: string; used: number; quota: number | null }) {
  const pct = quota && quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : null;
  return (
    <div className="flex flex-col gap-1.5 py-3 border-b border-[var(--line-faint)] last:border-b-0">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-wider text-[var(--ink-secondary)]">{label}</span>
        <span className="font-mono text-xs text-[var(--ink)]">
          {used}{quota !== null ? ` / ${quota}` : ' (unlimited)'}
        </span>
      </div>
      {pct !== null && (
        <div className="h-1.5 rounded-full bg-[var(--surface)] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--err)' : pct >= 80 ? 'var(--warn)' : 'var(--accent)' }}
          />
        </div>
      )}
    </div>
  );
}

/** Wave U — usage tab. Reads GET /api/usage/summary; degrades to "no usage yet" rather than an error when the account is simply new. */
export function UsageTab() {
  const { summary, loading, error } = useUsageSummary(true);

  if (loading && !summary) {
    return <div className="p-6 text-center text-[var(--ink-muted)] text-xs font-mono">Loading usage…</div>;
  }
  if (error) {
    return <div className="p-6 text-center text-[var(--err)] text-xs font-mono">{error}</div>;
  }
  if (!summary) {
    return <div className="p-6 text-center text-[var(--ink-muted)] text-xs font-mono">No usage yet this period.</div>;
  }

  const periodLabel = new Date(summary.periodStart).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className="max-w-lg mx-auto p-4 sm:p-6">
      <div className="mb-4">
        <h2 className="font-mono text-sm font-bold uppercase tracking-wider text-[var(--ink)]">Usage — {periodLabel}</h2>
        <p className="text-[11px] text-[var(--ink-muted)] mt-1">Plan: {summary.tier}</p>
      </div>
      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4">
        <UsageRow label="Video Analyses" used={summary.analyses.used} quota={summary.analyses.quota} />
        <UsageRow label="Synthesis Console Chat Turns" used={summary.chatTurns.synthesisConsole} quota={null} />
        <UsageRow label="Atlas Chat Turns" used={summary.chatTurns.atlas} quota={null} />
      </div>
      {summary.estimatedCostUsd > 0 && (
        <p className="mt-3 text-[11px] text-[var(--ink-muted)] font-mono">
          Estimated platform cost this period: ${summary.estimatedCostUsd.toFixed(4)}
        </p>
      )}
    </div>
  );
}
