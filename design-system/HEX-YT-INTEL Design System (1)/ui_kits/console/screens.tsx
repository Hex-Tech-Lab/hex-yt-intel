import React, { CSSProperties } from "react";
import { Icon, MonoLabel, StatusBadge, GlowBorder, SynthesisStatus } from "./primitives";

interface AnalysisHeroProps {
  url: string;
  status: SynthesisStatus;
  onUrlChange: (v: string) => void;
  onAnalyze: () => void;
  error?: string;
  quota?: string;
}

export function AnalysisHero({
  url,
  status,
  onUrlChange,
  onAnalyze,
  error,
  quota,
}: AnalysisHeroProps) {
  const streaming = status === "streaming";
  const disabled = streaming || !url || url.trim().length === 0;

  return (
    <section className="hx-rise">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <MonoLabel index="//">synthesis console</MonoLabel>
        <StatusBadge status={status} />
      </div>

      <h1 className="hx-h1" style={{ maxWidth: "20ch" }}>
        Drop a YouTube URL. Get a structured synthesis across 11 dimensions.
      </h1>
      <p className="hx-body-lg" style={{ marginTop: 12, maxWidth: "54ch" }}>
        Transcript, claims, frameworks, and contrarian takes, mapped into your
        knowledge graph and searchable in seconds.
      </p>

      <GlowBorder
        active={streaming}
        radius="control"
        style={{ marginTop: 28, maxWidth: 640 }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "var(--surface)",
            padding: 8,
            borderRadius: 7,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: "grid",
              placeItems: "center",
              width: 36,
              height: 36,
              borderRadius: 8,
              background: "var(--bg)",
              color: "var(--accent)",
              flex: "none",
            }}
          >
            <Icon icon="solar:link-round-angle-linear" size={19} />
          </span>
          <input
            type="url"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !disabled) onAnalyze();
            }}
            placeholder="https://youtube.com/watch?v=..."
            aria-label="YouTube video URL"
            style={{
              minWidth: 0,
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              padding: "0 4px",
              fontFamily: "var(--font-mono)",
              fontSize: 13.5,
              color: "var(--ink)",
            }}
          />
          <button
            type="button"
            onClick={onAnalyze}
            disabled={disabled}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              borderRadius: 8,
              border: "none",
              background: "var(--accent-strong)",
              color: "var(--void)",
              padding: "10px 16px",
              fontFamily: "var(--font-sans)",
              fontSize: 13.5,
              fontWeight: 500,
              cursor: disabled && !streaming ? "not-allowed" : "pointer",
              opacity: disabled && !streaming ? 0.4 : 1,
              transition: "background var(--dur-fast)",
            }}
          >
            <Icon
              icon={streaming ? "solar:refresh-linear" : "solar:bolt-linear"}
              size={16}
            />
            {streaming ? "Analyzing" : "Analyze"}
          </button>
        </div>
      </GlowBorder>

      <div
        style={{
          marginTop: 8,
          display: "flex",
          minHeight: 20,
          maxWidth: 640,
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 12,
        }}
      >
        {status === "error" && error && (
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--err)" }}>
            {error}
          </span>
        )}
        {quota && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              color: "var(--ink-muted)",
            }}
          >
            {quota}
          </span>
        )}
      </div>
    </section>
  );
}

type UCISDimension = "thesis" | "arguments" | "evidence" | "frameworks" | "entities" | "tactics" | "contrarian" | "questions" | "actions" | "quotes" | "connections";

const DIMENSION_META: Record<
  UCISDimension,
  { label: string; icon: string }
> = {
  thesis: { label: "CORE THESIS", icon: "solar:target-linear" },
  arguments: { label: "KEY ARGUMENTS", icon: "solar:chat-square-like-linear" },
  evidence: { label: "EVIDENCE", icon: "solar:database-linear" },
  frameworks: { label: "FRAMEWORKS", icon: "solar:widget-5-linear" },
  entities: { label: "ENTITIES", icon: "solar:users-group-rounded-linear" },
  tactics: { label: "TACTICS", icon: "solar:bolt-linear" },
  contrarian: { label: "CONTRARIAN TAKES", icon: "solar:shuffle-linear" },
  questions: { label: "OPEN QUESTIONS", icon: "solar:question-circle-linear" },
  actions: { label: "ACTION ITEMS", icon: "solar:checklist-minimalistic-linear" },
  quotes: { label: "NOTABLE QUOTES", icon: "solar:quote-up-linear" },
  connections: { label: "GRAPH LINKS", icon: "solar:graph-linear" },
};

interface DimensionCardProps {
  key: UCISDimension;
  status: SynthesisStatus;
  content?: string;
  span?: 1 | 2 | 3;
  onOpen?: (key: UCISDimension) => void;
  delayClass?: string;
}

const SPAN: Record<1 | 2 | 3, string> = {
  1: "span 2",
  2: "span 3",
  3: "span 4",
};

const ROWSPAN: Record<1 | 2 | 3, string> = {
  1: "span 1",
  2: "span 1",
  3: "span 2",
};

export function DimensionCard({
  key,
  status,
  content,
  span = 1,
  onOpen,
  delayClass = "",
}: DimensionCardProps) {
  const meta = DIMENSION_META[key];
  const streaming = status === "streaming";
  const interactive = status === "done" && Boolean(onOpen);
  const index = Object.keys(DIMENSION_META).indexOf(key) + 1;

  return (
    <GlowBorder active={streaming} radius="card" className={delayClass}>
      <article
        onClick={interactive ? () => onOpen?.(key) : undefined}
        data-status={status}
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          background: "var(--surface)",
          padding: 20,
          borderRadius: 15,
          boxSizing: "border-box",
          boxShadow:
            status === "error"
              ? "inset 0 0 0 1px rgb(239 68 68 / 0.4)"
              : "none",
          cursor: interactive ? "pointer" : "default",
          transition: "transform var(--dur-base)",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <MonoLabel index={String(index).padStart(2, "0")}>
            {meta.label}
          </MonoLabel>
          <span
            aria-hidden="true"
            style={{
              display: "grid",
              placeItems: "center",
              width: 32,
              height: 32,
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--bg)",
              color: streaming ? "var(--accent)" : "var(--ink-secondary)",
            }}
          >
            <Icon icon={meta.icon} size={16} />
          </span>
        </header>

        <div style={{ minHeight: 0, flex: 1 }}>
          {status === "done" && content ? (
            <div
              style={{
                fontSize: 13.5,
                lineHeight: 1.55,
                color: "var(--ink-secondary)",
              }}
            >
              {content}
            </div>
          ) : status === "error" ? (
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "var(--err)",
              }}
            >
              Synthesis failed for this dimension. Retry available.
            </p>
          ) : (
            <div
              aria-hidden="true"
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              <div
                style={{
                  height: 8,
                  width: "84%",
                  borderRadius: 9999,
                  background: "rgb(51 65 85 / 0.5)",
                }}
              />
              <div
                style={{
                  height: 8,
                  width: "62%",
                  borderRadius: 9999,
                  background: "rgb(51 65 85 / 0.35)",
                }}
              />
              {span >= 2 && (
                <div
                  style={{
                    height: 8,
                    width: "72%",
                    borderRadius: 9999,
                    background: "rgb(51 65 85 / 0.35)",
                  }}
                />
              )}
            </div>
          )}
        </div>
      </article>
    </GlowBorder>
  );
}

interface StreamingGridProps {
  dimensions: DimensionCardProps[];
  onOpenDimension?: (key: UCISDimension) => void;
  progress?: string;
}

export function StreamingGrid({
  dimensions,
  onOpenDimension,
  progress,
}: StreamingGridProps) {
  return (
    <section>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <MonoLabel index="//">semantic dimensions</MonoLabel>
        {progress && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.08em",
              color: "var(--ink-muted)",
            }}
          >
            {progress}
          </span>
        )}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, 1fr)",
          gridAutoRows: "minmax(132px, auto)",
          gap: 14,
        }}
      >
        {dimensions.map((d, i) => (
          <DimensionCard
            key={d.key}
            {...d}
            delayClass={`hx-rise hx-rise-${(i % 4) + 1}`}
            onOpen={onOpenDimension}
          />
        ))}
      </div>
    </section>
  );
}
