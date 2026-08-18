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
      <Icon icon="solar:check-circle-bold" size={18} style={{ color: "var(--ok)" }} />
    ) : (
      <Icon icon="solar:close-circle-linear" size={18} style={{ color: "var(--ink-muted)", opacity: 0.3 }} />
    );
  }
  return <span style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{value}</span>;
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
    onMouseLeave: () => setHoveredCol((c) => (c === col ? null : c)),
  });

  return (
    <div style={{
      marginTop: 80,
      width: "100%",
      borderRadius: 16,
      border: "1px solid var(--line)",
      background: "rgb(26 31 43 / 0.4)",
      overflow: "hidden"
    }}>
      <Table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
        <TableHeader>
          <TableRow style={{ borderBottom: "1px solid var(--line)", background: "var(--bg)" }}>
            <TableHeaderCell style={{ padding: "24px 32px", width: "40%" }}>
              <p style={{ margin: 0, fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>{"// Capability"}</p>
            </TableHeaderCell>
            {PLAN_COLUMNS.map((col) => (
              <TableHeaderCell
                key={col}
                style={{
                  padding: "24px 20px",
                  textAlign: "center",
                  background: colBg(col),
                  transition: "background 0.15s ease",
                }}
                {...colHandlers(col)}
              >
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: col === "pro" ? "var(--accent)" : "var(--ink)" }}>{PLAN_LABELS[col]}</p>
              </TableHeaderCell>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {COMPARISON_DATA.map((cat) => (
            <React.Fragment key={cat.category}>
              {/* Category Header */}
              <TableRow style={{ background: "rgb(17 20 29 / 0.6)" }}>
                <TableCell colSpan={PLAN_COLUMNS.length + 1} style={{ padding: "12px 32px", borderBottom: "1px solid var(--line)" }}>
                  <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {cat.category}
                  </span>
                </TableCell>
              </TableRow>
              {/* Features */}
              {cat.features.map((feat) => (
                <TableRow key={feat.name} style={{ borderBottom: "1px solid var(--line-faint)" }}>
                  <TableCell style={{ padding: "16px 32px" }}>
                    <p style={{ margin: 0, fontSize: 14, color: "var(--ink-secondary)" }}>{feat.name}</p>
                  </TableCell>
                  {PLAN_COLUMNS.map((col) => (
                    <TableCell
                      key={col}
                      style={{ padding: "16px 20px", background: colBg(col), transition: "background 0.15s ease" }}
                      {...colHandlers(col)}
                    >
                      <div style={{ display: "flex", justifyContent: "center" }}><CheckOrValue value={feat[col]} /></div>
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
