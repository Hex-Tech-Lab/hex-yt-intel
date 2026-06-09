import React, { ReactNode, CSSProperties } from "react";

/* ============================================================================
   HEX-YT-INTEL PRESENTATION PRIMITIVES
   Pure stateless adapters. React 19: ref is a normal prop (no forwardRef).
   ========================================================================= */

interface IconProps {
  icon: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ icon, size = 16, className = "", style = {} }: IconProps) {
  return (
    <iconify-icon
      icon={icon}
      className={className}
      style={{ fontSize: size, ...style } as any}
    />
  );
}

interface GlowBorderProps {
  children: ReactNode;
  active?: boolean;
  radius?: "card" | "control";
  className?: string;
  style?: CSSProperties;
}

export function GlowBorder({
  children,
  active = false,
  radius = "card",
  className = "",
  style = {},
}: GlowBorderProps) {
  const r = radius === "card" ? 16 : 8;
  return (
    <div
      className={`hx-glow ${className}`}
      data-active={active}
      style={{
        position: "relative",
        padding: 1,
        borderRadius: r,
        overflow: "hidden",
        background: active
          ? "transparent"
          : "linear-gradient(135deg, rgb(148 163 184 / 0.18) 0%, rgb(148 163 184 / 0) 60%)",
        ...style,
      }}
    >
      {active && (
        <span
          aria-hidden="true"
          className="hx-spin"
          style={{
            position: "absolute",
            inset: "-40%",
            background:
              "conic-gradient(from var(--hx-angle), transparent 55%, var(--accent) 78%, transparent 92%)",
            animation: "hx-rotate-ring 3s linear infinite",
          }}
        />
      )}
      <div
        style={{
          position: "relative",
          borderRadius: r - 1,
          height: "100%",
          width: "100%",
        }}
      >
        {children}
      </div>
    </div>
  );
}

interface CornerFrameProps {
  children: ReactNode;
  tone?: "line" | "accent";
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export function CornerFrame({
  children,
  tone = "line",
  size = 14,
  className = "",
  style = {},
}: CornerFrameProps) {
  const color =
    tone === "accent" ? "rgb(6 182 212 / 0.7)" : "rgb(51 65 85 / 0.6)";

  const armBase: CSSProperties = {
    position: "absolute",
    width: size,
    height: size,
    pointerEvents: "none",
    color,
  };

  return (
    <div
      className={className}
      style={{ position: "relative", ...style }}
    >
      <span
        aria-hidden="true"
        style={{
          ...armBase,
          top: -1,
          left: -1,
          borderTop: "1.5px solid",
          borderLeft: "1.5px solid",
        }}
      />
      <span
        aria-hidden="true"
        style={{
          ...armBase,
          top: -1,
          right: -1,
          borderTop: "1.5px solid",
          borderRight: "1.5px solid",
        }}
      />
      <span
        aria-hidden="true"
        style={{
          ...armBase,
          bottom: -1,
          left: -1,
          borderBottom: "1.5px solid",
          borderLeft: "1.5px solid",
        }}
      />
      <span
        aria-hidden="true"
        style={{
          ...armBase,
          bottom: -1,
          right: -1,
          borderBottom: "1.5px solid",
          borderRight: "1.5px solid",
        }}
      />
      {children}
    </div>
  );
}

interface MonoLabelProps {
  children: ReactNode;
  index?: string;
  className?: string;
  style?: CSSProperties;
}

export function MonoLabel({
  children,
  index,
  className = "",
  style = {},
}: MonoLabelProps) {
  return (
    <span
      className={`hx-mono-label ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        ...style,
      }}
    >
      {index && (
        <span className="hx-mono-index" style={{ color: "rgb(6 182 212 / 0.7)" }}>
          {index}
        </span>
      )}
      {children}
    </span>
  );
}

type SynthesisStatus = "idle" | "streaming" | "done" | "error";

interface StatusBadgeProps {
  status: SynthesisStatus;
  label?: string;
  style?: CSSProperties;
}

const STATUS_MAP: Record<
  SynthesisStatus,
  { label: string; dot: string; text: string; pulse: boolean }
> = {
  idle: {
    label: "IDLE",
    dot: "var(--ink-muted)",
    text: "var(--ink-muted)",
    pulse: false,
  },
  streaming: {
    label: "STREAMING",
    dot: "var(--accent)",
    text: "var(--accent-ink)",
    pulse: true,
  },
  done: {
    label: "DONE",
    dot: "var(--ok)",
    text: "var(--ink-secondary)",
    pulse: false,
  },
  error: {
    label: "ERROR",
    dot: "var(--err)",
    text: "var(--err)",
    pulse: false,
  },
};

export function StatusBadge({
  status,
  label,
  style = {},
}: StatusBadgeProps) {
  const s = STATUS_MAP[status] || STATUS_MAP.idle;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        borderRadius: 9999,
        border: "1px solid var(--line)",
        background: "rgb(26 31 43 / 0.6)",
        padding: "5px 12px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.08em",
        color: s.text,
        ...style,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: s.dot,
          animation: s.pulse ? "hx-pulse 1.4s ease-in-out infinite" : "none",
        }}
      />
      {label || s.label}
    </span>
  );
}

export type { SynthesisStatus };
