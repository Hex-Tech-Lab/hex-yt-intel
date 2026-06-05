'use client';

import { ReactNode, useState } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';

export interface TopBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit?: () => void;
  onExport?: (format: 'pdf' | 'markdown') => void;
  tier?: string;
  account?: ReactNode;
}

export function TopBar({ search, onSearchChange, onSearchSubmit, onExport, tier, account }: TopBarProps) {
  const [exportOpen, setExportOpen] = useState(false);

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
          className="hx-field"
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

      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setExportOpen(!exportOpen)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            borderRadius: 8,
            border: '1px solid var(--line)',
            background: 'var(--surface)',
            color: 'var(--ink-secondary)',
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            transition: 'all 0.2s'
          }}
          className="hx-navitem"
        >
          <Icon icon="solar:download-minimalistic-linear" size={14} />
          Export
          <Icon icon="solar:alt-arrow-down-linear" size={12} style={{ transform: exportOpen ? 'rotate(180deg)' : 'none' }} />
        </button>

        {exportOpen && (
          <>
            <div 
              style={{ position: 'fixed', inset: 0, zIndex: 40 }}
              onClick={() => setExportOpen(false)}
            />
            <div 
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                width: 160,
                background: 'var(--surface-raised)',
                border: '1px solid var(--line-strong)',
                borderRadius: 10,
                padding: 4,
                boxShadow: '0 10px 25px -5px rgba(0,0,0,0.5)',
                zIndex: 50,
                display: 'flex',
                flexDirection: 'column',
                gap: 2
              }}
              className="hx-rise"
            >
              <button
                onClick={() => { onExport?.('pdf'); setExportOpen(false); }}
                style={dropdownItem}
              >
                <Icon icon="solar:file-text-linear" size={14} />
                Export as PDF
              </button>
              <button
                onClick={() => { onExport?.('markdown'); setExportOpen(false); }}
                style={dropdownItem}
              >
                <Icon icon="solar:document-text-linear" size={14} />
                Export as Markdown
              </button>
            </div>
          </>
        )}
      </div>

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

const dropdownItem: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  color: 'var(--ink-secondary)',
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: 'var(--font-mono)',
  textAlign: 'left',
  transition: 'all 0.2s',
};
