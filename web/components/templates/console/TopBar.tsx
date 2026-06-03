'use client';

import { ReactNode } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';

export interface TopBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit?: () => void;
  tier?: string;
  account?: ReactNode;
}

export function TopBar({ search, onSearchChange, onSearchSubmit, tier, account }: TopBarProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 24px" }}>
      <label
        style={{
          display: "flex",
          minWidth: 0,
          flex: 1,
          alignItems: "center",
          gap: 8,
          maxWidth: 460,
          borderRadius: 8,
          border: "1px solid var(--line)",
          background: "rgb(26 31 43 / 0.6)",
          padding: "8px 12px",
        }}
      >
        <Icon icon="solar:magnifer-linear" size={16} style={{ color: "var(--ink-muted)" }} />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onSearchSubmit?.(); }}
          placeholder="Search your knowledge graph"
          aria-label="Search syntheses"
          style={{
            minWidth: 0,
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--ink)",
            fontFamily: "var(--font-sans)",
            fontSize: 13.5
          }}
        />
        <kbd style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-muted)", border: "1px solid var(--line)", borderRadius: 4, padding: "1px 6px" }}>
          ⌘K
        </kbd>
      </label>

      <span style={{ flex: 1 }} />

      {tier && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            borderRadius: 9999,
            border: "1px solid rgb(6 182 212 / 0.3)",
            background: "rgb(6 182 212 / 0.10)",
            padding: "4px 11px",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.08em",
            color: "var(--accent-ink)",
          }}
        >
          <Icon icon="solar:crown-minimalistic-linear" size={12} />
          {tier.toUpperCase()}
        </span>
      )}

      {account || (
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: 32,
            height: 32,
            borderRadius: 8,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            color: "var(--ink-secondary)",
            cursor: "pointer"
          }}
        >
          <Icon icon="solar:user-linear" size={16} />
        </span>
      )}
    </div>
  );
}
