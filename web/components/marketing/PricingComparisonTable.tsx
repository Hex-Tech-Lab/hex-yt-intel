'use client';

import React from 'react';
import { Table, TableHeader, TableBody, TableRow, TableCell, TableHeaderCell } from '@astryxdesign/core';
import { Icon } from '@/components/templates/_shared/primitives';

interface FeatureRow {
  name: string;
  free: string | boolean;
  light: string | boolean;
  pro: string | boolean;
  max: string | boolean;
  desc?: string;
}

interface FeatureCategory {
  category: string;
  features: FeatureRow[];
}

// Mirrors the candidate Free/Light/Pro/Max structure in pricing-table-client.tsx —
// keep both in sync. API access is intentionally omitted: not offered yet.
const COMPARISON_DATA: FeatureCategory[] = [
  {
    category: "Synthesis Engine",
    features: [
      { name: "Monthly analyses", free: "Limited (resets monthly)", light: "15 / mo", pro: "60 / mo", max: "~120–150 / mo" },
      { name: "Video hours / mo", free: "1 analysis", light: "5 hrs", pro: "20 hrs", max: "~40 hrs" },
      { name: "Semantic dimensions", free: "Full-quality (single run)", light: "Focused subset", pro: "Full (11)", max: "Full (11)" },
      { name: "UCIS Intelligence", free: true, light: true, pro: true, max: true },
    ]
  },
  {
    category: "Knowledge Graph",
    features: [
      { name: "Transcript retention", free: "72 hrs (transient)", light: "72 hrs (transient)", pro: "72 hrs (transient)", max: "72 hrs (transient)" },
      { name: "WordCloud", free: true, light: true, pro: true, max: true },
      { name: "MindMap + Knowledge Graph Canvas", free: false, light: true, pro: true, max: true },
      { name: "Executive Digest + Apex Intelligence", free: true, light: true, pro: true, max: true },
      { name: "Full 11-dimension breakdown", free: false, light: false, pro: true, max: true },
    ]
  },
  {
    category: "Processing",
    features: [
      { name: "Processing speed", free: "Standard 48–72hr", light: "Standard", pro: "Standard", max: "Priority (candidate)" },
      { name: "PDF / Markdown export", free: false, light: true, pro: true, max: true },
    ]
  },
];

function CheckOrValue({ value }: { value: string | boolean }) {
  if (typeof value === 'boolean') {
    return value ? (
      <Icon icon="solar:check-circle-bold" size={18} className="text-[var(--ok)]" />
    ) : (
      <Icon icon="solar:close-circle-linear" size={18} className="text-[var(--ink-muted)] opacity-30" />
    );
  }
  return <span className="text-[13px] font-medium text-[var(--ink)]">{value}</span>;
}

const PLAN_COLUMNS = ["free", "light", "pro", "max"] as const;
type PlanColumn = (typeof PLAN_COLUMNS)[number];

const PLAN_LABELS: Record<PlanColumn, string> = { free: "Free", light: "Light", pro: "Pro", max: "Max" };

export function PricingComparisonTable() {
  // Column-level hover highlight: tracks which plan column the cursor is
  // over (header or any data cell) so the whole column can be lit up,
  // not just the individual cell — a spreadsheet-style column hover.
  const [hoveredCol, setHoveredCol] = React.useState<PlanColumn | null>(null);

  function colBg(col: PlanColumn): string | undefined {
    if (hoveredCol === col) return "var(--accent-a06)";
    if (col === "pro") return "var(--accent-a03)";
    return undefined;
  }

  const colHandlers = (col: PlanColumn) => ({
    onMouseEnter: () => setHoveredCol(col),
    onMouseLeave: () => setHoveredCol((current) => (current === col ? null : current)),
  });

  return (
    <div className="mt-20 w-full overflow-hidden rounded-2xl border border-[var(--line)] bg-[rgb(26_31_43_/_0.4)]">
      <Table className="w-full border-collapse text-left">
        <TableHeader>
          <TableRow className="border-b border-[var(--line)] bg-[var(--bg)]">
            <TableHeaderCell className="w-2/5 px-8 py-6">
              <p className="m-0 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--ink-muted)]">{"// Capability"}</p>
            </TableHeaderCell>
            {PLAN_COLUMNS.map((col) => (
              <TableHeaderCell
                key={col}
                className="px-5 py-6 text-center transition-[background] duration-150 ease-out"
                style={{ background: colBg(col) }}
                {...colHandlers(col)}
              >
                <p className={`m-0 text-sm font-semibold ${col === "pro" ? "text-[var(--accent)]" : "text-[var(--ink)]"}`}>{PLAN_LABELS[col]}</p>
              </TableHeaderCell>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {COMPARISON_DATA.map((cat) => (
            <React.Fragment key={cat.category}>
              {/* Category Header */}
              <TableRow className="bg-[rgb(17_20_29_/_0.6)]">
                <TableCell colSpan={PLAN_COLUMNS.length + 1} className="border-b border-[var(--line)] px-8 py-3">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--ink-muted)]">
                    {cat.category}
                  </span>
                </TableCell>
              </TableRow>
              {/* Features */}
              {cat.features.map((feat) => (
                <TableRow key={feat.name} className="border-b border-[var(--line-faint)]">
                  <TableCell className="px-8 py-4">
                    <p className="m-0 text-sm text-[var(--ink-secondary)]">{feat.name}</p>
                  </TableCell>
                  {PLAN_COLUMNS.map((col) => (
                    <TableCell
                      key={col}
                      className="px-5 py-4 transition-[background] duration-150 ease-out"
                      style={{ background: colBg(col) }}
                      {...colHandlers(col)}
                    >
                      <div className="flex justify-center"><CheckOrValue value={feat[col]} /></div>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
