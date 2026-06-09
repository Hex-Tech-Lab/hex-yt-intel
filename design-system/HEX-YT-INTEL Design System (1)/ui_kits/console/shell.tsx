import React, { CSSProperties } from "react";
import { Icon, MonoLabel, StatusBadge, SynthesisStatus } from "./primitives";

interface SidebarItem {
  key: string;
  label: string;
  icon: string;
  badge?: string;
}

interface SidebarProps {
  items: SidebarItem[];
  activeKey: string;
  onNavigate: (key: string) => void;
  repoScope?: { label: string; onClick: () => void };
}

export function Sidebar({
  items,
  activeKey,
  onNavigate,
  repoScope,
}: SidebarProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: "20px 12px",
        background: "rgb(17 20 29 / 0.7)",
        backdropFilter: "blur(12px)",
        borderRight: "1px solid var(--line)",
      }}
    >
      {/* Brand */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 8px 24px",
        }}
      >
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: 28,
            height: 28,
            borderRadius: 8,
            background: "var(--accent-strong)",
            color: "var(--void)",
          }}
        >
          <Icon icon="solar:graph-up-linear" size={17} />
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: "0.04em",
            color: "var(--ink)",
          }}
        >
          HEX·YT
        </span>
      </div>

      {/* Navigation */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
        {items.map((it) => {
          const active = it.key === activeKey;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => onNavigate(it.key)}
              aria-current={active ? "page" : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                borderRadius: 8,
                padding: "8px 11px",
                fontSize: 13.5,
                fontFamily: "var(--font-sans)",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                transition: "background var(--dur-fast), color var(--dur-fast)",
                background: active ? "rgb(6 182 212 / 0.10)" : "transparent",
                color: active ? "var(--ink)" : "var(--ink-secondary)",
              }}
            >
              <Icon
                icon={it.icon}
                size={17}
                style={{ color: active ? "var(--accent)" : "inherit" }}
              />
              <span style={{ flex: 1 }}>{it.label}</span>
              {it.badge && (
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--ink-muted)",
                  }}
                >
                  {it.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Repo scope */}
      {repoScope && (
        <button
          type="button"
          onClick={repoScope.onClick}
          style={{
            marginTop: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderRadius: 8,
            border: "1px solid var(--line)",
            background: "rgb(26 31 43 / 0.6)",
            padding: "10px 12px",
            fontSize: 13,
            color: "var(--ink-secondary)",
            cursor: "pointer",
            fontFamily: "var(--font-sans)",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon
              icon="solar:folder-with-files-linear"
              size={16}
              style={{ color: "rgb(6 182 212 / 0.8)" }}
            />
            {repoScope.label}
          </span>
          <Icon icon="solar:alt-arrow-down-linear" size={14} />
        </button>
      )}
    </div>
  );
}

interface TopBarProps {
  search: string;
  onSearchChange: (v: string) => void;
  onSearchSubmit?: () => void;
  tier?: string;
  account?: React.ReactNode;
}

export function TopBar({
  search,
  onSearchChange,
  onSearchSubmit,
  tier,
  account,
}: TopBarProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 24px",
        borderBottom: "1px solid var(--line)",
        background: "rgb(17 20 29 / 0.7)",
        backdropFilter: "blur(12px)",
      }}
    >
      {/* Search */}
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
        <Icon
          icon="solar:magnifer-linear"
          size={16}
          style={{ color: "var(--ink-muted)" }}
        />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSearchSubmit?.();
          }}
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
            fontSize: 13.5,
          }}
        />
        <kbd
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--ink-muted)",
            border: "1px solid var(--line)",
            borderRadius: 4,
            padding: "1px 6px",
          }}
        >
          ⌘K
        </kbd>
      </label>

      <span style={{ flex: 1 }} />

      {/* Tier pill */}
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

      {/* Account */}
      {account || (
        <button
          type="button"
          style={{
            display: "grid",
            placeItems: "center",
            width: 32,
            height: 32,
            borderRadius: 8,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            color: "var(--ink-secondary)",
            cursor: "pointer",
          }}
        >
          <Icon icon="solar:user-linear" size={16} />
        </button>
      )}
    </div>
  );
}
