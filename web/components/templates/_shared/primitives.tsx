'use client';

import { ReactNode, CSSProperties } from 'react';
import { Icon as IconifyIcon } from '@iconify/react';
import { Tooltip } from '@astryxdesign/core';

export interface IconProps {
  icon: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * High-fidelity bundled Iconify React wrapper.
 * Bundles icons locally via @iconify/react so UI icons never fail or disappear
 * when third-party CDNs (code.iconify.design) time out or block network requests.
 */
export function Icon({ icon, size = 16, className = "", style = {} }: IconProps) {
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
