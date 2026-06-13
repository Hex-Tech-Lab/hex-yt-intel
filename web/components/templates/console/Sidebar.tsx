'use client';

import { Icon } from '@/components/templates/_shared/primitives';
import Link from 'next/link';

export interface SidebarItem {
  key: string;
  label: string;
  icon: string;
  badge?: string;
}

export interface RepoScope {
  label: string;
  onClick: () => void;
}

export interface SidebarProps {
  items: SidebarItem[];
  activeKey: string;
  onNavigate: (key: string) => void;
  repoScope?: RepoScope;
  children?: React.ReactNode;
}

export function Sidebar({ items, activeKey, onNavigate, repoScope, children }: SidebarProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "24px 14px" }}>
      {/* brand */}
      <Link href="/?v=landing" style={{ textDecoration: 'none', display: 'block' }} className="group">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 10px 32px" }}>
          <span style={{ 
            display: "grid", 
            placeItems: "center", 
            width: 30, 
            height: 30, 
            borderRadius: 8, 
            background: "var(--accent-strong)", 
            color: "var(--void)",
            boxShadow: "0 4px 12px var(--accent-glow)"
          }}>
            <Icon icon="solar:graph-up-linear" size={18} />
          </span>
          <span style={{ 
            fontFamily: "var(--font-mono)", 
            fontSize: 15, 
            fontWeight: 700, 
            letterSpacing: "0.02em", 
            color: "var(--ink)",
            textShadow: "0 0 20px var(--accent-glow)"
          }}>
            HEX{"\u00b7"}YT
          </span>
        </div>
      </Link>

      {/* nav */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
        {items.map((it) => {
          const active = it.key === activeKey;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => onNavigate(it.key)}
              aria-current={active ? "page" : undefined}
              className="hx-navitem group"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 14,
                fontFamily: "var(--font-sans)",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                transition: "all var(--dur-fast)",
                background: active ? "rgb(6 182 212 / 0.10)" : "transparent",
                color: active ? "var(--ink)" : "var(--ink-secondary)",
                boxShadow: active ? "inset 0 0 0 1px rgb(6 182 212 / 0.15)" : "none"
              }}
            >
              <Icon icon={it.icon} size={18} style={{ color: active ? "var(--accent)" : "inherit", transition: "color var(--dur-fast)" }} />
              <span style={{ flex: 1, fontWeight: active ? 600 : 400 }}>{it.label}</span>
              {it.badge && (
                <span style={{ 
                  fontFamily: "var(--font-mono)", 
                  fontSize: 10, 
                  color: active ? "var(--accent-ink)" : "var(--ink-muted)",
                  background: active ? "rgb(6 182 212 / 0.1)" : "rgb(51 65 85 / 0.2)",
                  padding: "1px 6px",
                  borderRadius: 4
                }}>
                  {it.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* children (e.g. ProcessingLog) */}
      {children && <div style={{ marginTop: "auto", marginBottom: "12px" }}>{children}</div>}

      {/* repo scope */}
      {repoScope && (
        <button
          type="button"
          onClick={repoScope.onClick}
          className="hx-navitem"
          style={{
            marginTop: children ? "0" : "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderRadius: 10,
            border: "1px solid var(--line)",
            background: "rgb(26 31 43 / 0.6)",
            padding: "12px 14px",
            fontSize: 13,
            color: "var(--ink-secondary)",
            cursor: "pointer",
            fontFamily: "var(--font-sans)",
            transition: "all var(--dur-fast)"
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Icon icon="solar:folder-with-files-linear" size={16} style={{ color: "var(--accent)", opacity: 0.8 }} />
            <span style={{ fontWeight: 500 }}>{repoScope.label}</span>
          </span>
          <Icon icon="solar:alt-arrow-down-linear" size={14} style={{ opacity: 0.5 }} />
        </button>
      )}
    </div>
  );
}
