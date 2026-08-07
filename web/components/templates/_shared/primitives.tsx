'use client';

import { ReactNode, CSSProperties } from 'react';
// Offline variant: never performs a network fetch, only renders icons registered
// via addCollection/addIcon. This is what actually delivers the "bundled, never
// fails or disappears" guarantee -- the default `@iconify/react` `Icon` fetches
// SVG data from api.iconify.design at runtime per icon unless the icon set is
// pre-registered, which the previous implementation never did.
import { Icon as IconifyIcon, addCollection } from '@iconify/react/offline';
import { Tooltip } from '@astryxdesign/core';
// Trimmed Iconify collection containing only the "solar:*" icon names actually
// used across the app (see scripts/generate-icon-subset.mjs -- re-run it whenever
// a new solar: icon name is introduced, or the icon will render blank).
import solarSubset from '@/lib/icons/solar-subset.json';

let registered = false;
function ensureIconsRegistered() {
  if (registered) return;
  addCollection(solarSubset as Parameters<typeof addCollection>[0]);
  registered = true;
}

export interface IconProps {
  icon: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * High-fidelity bundled Iconify React wrapper.
 * Bundles icons locally via @iconify/react/offline + a pre-generated solar icon
 * subset (lib/icons/solar-subset.json), so UI icons render from the JS bundle
 * with zero runtime network calls -- never fail or disappear when third-party
 * CDNs (api.iconify.design) time out or block network requests.
 */
export function Icon({ icon, size = 16, className = "", style = {} }: IconProps) {
  ensureIconsRegistered();
  return (
    <IconifyIcon
      icon={icon}
      width={size}
      height={size}
      style={{ ...style }}
      className={className}
    />
  );
}

export interface GlowBorderProps {
  children: ReactNode;
  active?: boolean;
  radius?: 'card' | 'control';
  className?: string;
  style?: CSSProperties;
}

export function GlowBorder({ children, active = false, radius = "card", className = "", style = {} }: GlowBorderProps) {
  const computedRadius = radius === "card" ? 8 : 6;
  return (
    <div
      className={`hx-glow ${className}`}
      data-active={active}
      style={{
        position: "relative",
        padding: 1,
        borderRadius: computedRadius,
        overflow: "hidden",
        background: active ? "transparent" : "linear-gradient(135deg, rgb(148 163 184 / 0.18) 0%, rgb(148 163 184 / 0) 60%)",
        ...style,
      }}
    >
      {active && <span className="hx-spin" aria-hidden />}
      <div style={{ position: "relative", borderRadius: computedRadius - 1, height: "100%", width: "100%", overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}

export interface CornerFrameProps {
  children: ReactNode;
  tone?: 'line' | 'accent';
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export function CornerFrame({ children, tone = "line", size = 14, className = "", style = {} }: CornerFrameProps) {
  const color = tone === "accent" ? "var(--accent-a70)" : "rgb(51 65 85 / 0.6)";
  
  const Arm = ({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) => {
    const base: CSSProperties = { position: "absolute", width: size, height: size, pointerEvents: "none", color, zIndex: 5 };
    const map: Record<string, CSSProperties> = {
      tl: { top: -1, left: -1, borderTop: `1.5px solid`, borderLeft: `1.5px solid` },
      tr: { top: -1, right: -1, borderTop: `1.5px solid`, borderRight: `1.5px solid` },
      bl: { bottom: -1, left: -1, borderBottom: `1.5px solid`, borderLeft: `1.5px solid` },
      br: { bottom: -1, right: -1, borderBottom: `1.5px solid`, borderRight: `1.5px solid` },
    };
    return <span aria-hidden style={{ ...base, ...map[pos] }} />;
  };

  return (
    <div className={className} style={{ position: "relative", ...style }}>
      <Arm pos="tl" />
      <Arm pos="tr" />
      <Arm pos="bl" />
      <Arm pos="br" />
      {children}
    </div>
  );
}

export interface MonoLabelProps {
  children: ReactNode;
  index?: string;
  className?: string;
  style?: CSSProperties;
}

export function MonoLabel({ children, index, className = "", style = {} }: MonoLabelProps) {
  return (
    <span className={`hx-mono-label ${className}`} style={{ display: "inline-flex", alignItems: "center", gap: 8, ...style }}>
      {index && <span className="hx-mono-index">{index}</span>}
      {children}
    </span>
  );
}

export type SynthesisStatus = 'idle' | 'streaming' | 'done' | 'error';

export const STATUS_MAP = {
  idle:      { label: "IDLE",      dot: "var(--ink-muted)",  text: "var(--ink-muted)",     pulse: false },
  streaming: { label: "STREAMING", dot: "var(--accent)",     text: "var(--accent-ink)",    pulse: true },
  done:      { label: "DONE",      dot: "var(--ok)",         text: "var(--ink-secondary)", pulse: false },
  error:     { label: "ERROR",     dot: "var(--err)",        text: "var(--err)",           pulse: false },
};

export interface StatusBadgeProps {
  status: SynthesisStatus;
  label?: string;
  tooltip?: string;
  style?: CSSProperties;
}

export function StatusBadge({ status, label, tooltip, style = {} }: StatusBadgeProps) {
  const statusConfig = STATUS_MAP[status] || STATUS_MAP.idle;
  const tooltipText = tooltip || (label ? `${label} status: ${statusConfig.label}` : undefined);

  const badgeElement = (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        borderRadius: 6,
        border: "1px solid var(--line)",
        background: "rgb(26 31 43 / 0.6)",
        padding: "4px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: statusConfig.text,
        lineHeight: 1,
        userSelect: "none",
        cursor: tooltipText ? "help" : "default",
        ...style,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: statusConfig.dot,
          boxShadow: statusConfig.pulse ? `0 0 6px ${statusConfig.dot}` : "none",
        }}
      />
      {label || statusConfig.label}
    </span>
  );

  if (tooltipText) {
    return <Tooltip content={tooltipText}>{badgeElement}</Tooltip>;
  }

  return badgeElement;
}

/**
 * 3-state Chapter Chip: green (chapters present) | orange (attempted/no
 * markers) | grey (not attempted/predates feature, or still in flight).
 *
 * Single shared source of chapter-status chip logic -- moved here (was
 * previously defined only inside AnalysisHistory.tsx) so every screen
 * showing per-video status renders the identical chip instead of
 * independently reimplementing it. That drift is exactly what caused the
 * synth console's own aux-status row to be missing a Chapters entry
 * entirely (user report, 2026-08-07) while AnalysisHistory's list rows had
 * one -- one "chip" concept, one component, plugged in wherever needed.
 */
export function ChapterChip({ hasChapters }: { hasChapters: boolean | null }) {
  const config =
    hasChapters === true
      ? { label: 'Chapters', cls: 'bg-[var(--ok)]/15 text-[var(--ok)] border border-[var(--ok)]/40', title: 'Transcript chapters extracted from description' }
      : hasChapters === false
      ? { label: 'No Chapters', cls: 'bg-[var(--warn)]/15 text-[var(--warn)] border border-[var(--warn)]/40', title: 'Chapter parse attempted, no valid markers found' }
      : { label: 'Chapters N/A', cls: 'bg-transparent text-[var(--ink-muted)] border border-dashed border-[var(--line)]', title: 'Chapter parsing not attempted, still in progress, or failed for this video' };

  return (
    <Tooltip content={config.title}>
      <span className={`shrink-0 inline-flex items-center gap-1 text-[9px] font-mono font-semibold tabular-nums px-1.5 py-0.5 rounded ${config.cls}`}>
        <Icon icon="solar:bookmark-opened-linear" size={11} />
        {config.label}
      </span>
    </Tooltip>
  );
}
