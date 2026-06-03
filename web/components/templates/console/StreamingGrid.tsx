'use client';

import { MonoLabel, GlowBorder, Icon, SynthesisStatus, CornerFrame } from '@/components/templates/_shared/primitives';

export interface Dimension {
  key: string;
  label: string;
  icon: string;
  status: SynthesisStatus;
  content?: string;
  span?: 1 | 2 | 3;
}

export interface DimensionCardProps {
  dimension: Dimension;
  index: number;
  onOpen?: (key: string) => void;
  delayClass?: string;
}

// Maps 1, 2, 3 spans to CSS grid spans (2, 3, 4 columns out of 6)
const SPAN_MAP: Record<number, string> = { 1: "span 2", 2: "span 3", 3: "span 4" };

export function DimensionCard({ dimension, index, onOpen, delayClass }: DimensionCardProps) {
  const { key, label, icon, status, content, span = 1 } = dimension;
  const streaming = status === "streaming";
  const interactive = status === "done" && Boolean(onOpen);

  return (
    <GlowBorder
      active={streaming}
      radius="card"
      className={delayClass}
      style={{ gridColumn: SPAN_MAP[span] }}
    >
      <CornerFrame tone={streaming ? "accent" : "line"}>
        <article
          onClick={interactive ? () => onOpen?.(key) : undefined}
          onKeyDown={interactive ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen?.(key); } } : undefined}
          role={interactive ? "button" : undefined}
          tabIndex={interactive ? 0 : undefined}
          aria-label={interactive ? `Open ${label} dimension` : undefined}
          data-status={status}
          className={interactive ? "hx-liftcard" : ""}
          style={{
            display: "flex",
            flexDirection: "column",
            minHeight: 180,
            background: "var(--surface)",
            padding: 24,
            borderRadius: 15,
            boxSizing: "border-box",
            boxShadow: status === "error" ? "inset 0 0 0 1px rgb(239 68 68 / 0.4)" : "none",
            cursor: interactive ? "pointer" : "default",
            transition: "all var(--dur-base) var(--ease-out-quint)",
            border: "1px solid var(--line-faint)"
          }}
        >
          <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <MonoLabel index={String(index).padStart(2, "0")}>{label}</MonoLabel>
            <span aria-hidden={true} style={{
              display: "grid",
              placeItems: "center",
              width: 34,
              height: 34,
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--bg)",
              color: streaming ? "var(--accent)" : "var(--ink-secondary)",
              transition: "color var(--dur-fast)"
            }}>
              <Icon icon={icon} size={18} />
            </span>
          </header>

          <div style={{ flex: 1, overflowY: "auto", maxHeight: 320, paddingRight: 4 }} className="hx-custom-scrollbar">
            {status === "done" && content ? (
              <div className="hx-body-secondary" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                {content}
              </div>
            ) : status === "error" ? (
              <p style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--err)", opacity: 0.8 }}>
                Synthesis failed for this dimension. Retry available.
              </p>
            ) : (
              <div aria-hidden={true} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
                <div style={{ height: 6, width: "90%", borderRadius: 9999, background: "var(--line-strong)", opacity: 0.3 }} />
                <div style={{ height: 6, width: "70%", borderRadius: 9999, background: "var(--line-strong)", opacity: 0.2 }} />
                <div style={{ height: 6, width: "80%", borderRadius: 9999, background: "var(--line-strong)", opacity: 0.15 }} />
                {span >= 2 && <div style={{ height: 6, width: "50%", borderRadius: 9999, background: "var(--line-strong)", opacity: 0.1 }} />}
              </div>
            )}
          </div>

          {status === "done" && (
            <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
              <Icon icon="solar:alt-arrow-right-linear" size={14} style={{ color: "var(--accent)", opacity: 0.7 }} />
            </div>
          )}
        </article>
      </CornerFrame>
    </GlowBorder>
  );
}

export interface StreamingGridProps {
  dimensions: Dimension[];
  onOpenDimension?: (key: string) => void;
  progress?: string;
}

export function StreamingGrid({ dimensions, onOpenDimension, progress }: StreamingGridProps) {
  return (
    <section className="hx-rise">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <MonoLabel index="//">semantic dimensions</MonoLabel>
        {progress && (
          <span className="hx-mono" style={{ fontSize: 11, letterSpacing: "0.05em", color: "var(--accent-ink)" }}>
            {progress}
          </span>
        )}
      </div>
      <div className="hx-dim-grid">
        {dimensions.map((d, i) => (
          <DimensionCard
            key={d.key}
            dimension={d}
            index={i + 1}
            onOpen={onOpenDimension}
            delayClass={`hx-rise hx-rise-${(i % 4) + 1}`}
          />
        ))}
      </div>
    </section>
  );
}
