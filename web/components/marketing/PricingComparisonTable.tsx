'use client';

import React from 'react';
import { Table, TableHeader, TableBody, TableRow, TableCell, TableHeaderCell } from '@astryxdesign/core';
import { Icon } from '@/components/templates/_shared/primitives';

interface FeatureRow {
  name: string;
  free: string | boolean;
  pro: string | boolean;
  enterprise: string | boolean;
  desc?: string;
}

interface FeatureCategory {
  category: string;
  features: FeatureRow[];
}

const COMPARISON_DATA: FeatureCategory[] = [
  {
    category: "Synthesis Engine",
    features: [
      { name: "Monthly Syntheses", free: "3", pro: "Unlimited", enterprise: "1,000 / mo" },
      { name: "Max Video Length", free: "30 mins", pro: "12 hours", enterprise: "12 hours" },
      { name: "Semantic Dimensions", free: "Basic", pro: "Full (11+)", enterprise: "Full (11+)" },
      { name: "UCIS Intelligence", free: true, pro: true, enterprise: true },
    ]
  },
  {
    category: "Knowledge Graph",
    features: [
      { name: "Durable Persistence", free: "72 hrs (Transient)", pro: "Permanent", enterprise: "Permanent" },
      { name: "Semantic Search", free: false, pro: true, enterprise: true },
      { name: "Private Library", free: true, pro: true, enterprise: true },
      { name: "Workspace Insights", free: false, pro: true, enterprise: true },
    ]
  },
  {
    category: "Connectivity",
    features: [
      { name: "PDF / Markdown Export", free: false, pro: true, enterprise: true },
      { name: "API Access", free: false, pro: "Basic", enterprise: "High-throughput" },
      { name: "Custom Webhooks", free: false, pro: false, enterprise: true },
    ]
  },
  {
    category: "Enterprise & Trust",
    features: [
      { name: "SSO / SAML Auth", free: false, pro: false, enterprise: true },
      { name: "Priority SLA", free: false, pro: false, enterprise: true },
      { name: "Dedicated Infra", free: false, pro: false, enterprise: true },
      { name: "White-glove Setup", free: false, pro: false, enterprise: true },
    ]
  }
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

export function PricingComparisonTable() {
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
            <TableHeaderCell style={{ padding: "24px 20px", textAlign: "center" }}>
               <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>Free</p>
            </TableHeaderCell>
            <TableHeaderCell style={{ padding: "24px 20px", textAlign: "center", background: "var(--accent-a05)" }}>
               <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--accent)" }}>Pro</p>
            </TableHeaderCell>
            <TableHeaderCell style={{ padding: "24px 20px", textAlign: "center" }}>
               <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>Enterprise</p>
            </TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {COMPARISON_DATA.map((cat) => (
            <React.Fragment key={cat.category}>
              {/* Category Header */}
              <TableRow style={{ background: "rgb(17 20 29 / 0.6)" }}>
                <TableCell colSpan={4} style={{ padding: "12px 32px", borderBottom: "1px solid var(--line)" }}>
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
                  <TableCell style={{ padding: "16px 20px", textAlign: "center" }}>
                    <CheckOrValue value={feat.free} />
                  </TableCell>
                  <TableCell style={{ padding: "16px 20px", textAlign: "center", background: "var(--accent-a03)" }}>
                    <CheckOrValue value={feat.pro} />
                  </TableCell>
                  <TableCell style={{ padding: "16px 20px", textAlign: "center" }}>
                    <CheckOrValue value={feat.enterprise} />
                  </TableCell>
                </TableRow>
              ))}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
