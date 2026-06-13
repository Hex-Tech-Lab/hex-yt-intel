'use client';

import { MonoLabel, StatusBadge, GlowBorder, Icon, SynthesisStatus, CornerFrame } from '@/components/templates/_shared/primitives';

export interface AnalysisHeroProps {
  url: string;
  status: SynthesisStatus;
  onUrlChange: (url: string) => void;
  onAnalyze: () => void;
  onReanalyze: () => void;
  error?: string;
  quota?: string;
}

export function AnalysisHero({ url, status, onUrlChange, onAnalyze, onReanalyze, error, quota }: AnalysisHeroProps) {
  const streaming = status === "streaming";
  const disabled = streaming || !url || url.trim().length === 0;

  return (
    <section className="hx-rise">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <MonoLabel index="//">synthesis console</MonoLabel>
        <StatusBadge status={status} />
      </div>

      <div 
        style={{ 
          maxHeight: status !== 'idle' ? '0px' : '200px', 
          opacity: status !== 'idle' ? 0 : 1, 
          overflow: 'hidden', 
          transition: 'all 0.3s ease-out',
          marginBottom: status !== 'idle' ? 0 : 24
        }}
      >
        <h1 className="hx-h1" style={{ maxWidth: "20ch" }}>
          Drop a YouTube URL. Get a structured synthesis across 11 dimensions.
        </h1>
        <p className="hx-body-lg" style={{ marginTop: 12, maxWidth: "54ch" }}>
          Transcript, claims, frameworks, and contrarian takes, mapped into your knowledge graph and searchable in seconds.
        </p>
      </div>

      <div style={{ marginTop: 32, maxWidth: 640 }}>
        <CornerFrame tone={streaming ? "accent" : "line"}>
          <GlowBorder active={streaming} radius="control">
            <div style={{ 
              display: "flex", 
              alignItems: "center", 
              gap: 12, 
              background: "var(--surface)", 
              padding: 10, 
              borderRadius: 7,
              boxShadow: "0 10px 30px -10px rgba(0,0,0,0.5)"
            }}>
              <span aria-hidden={true} style={{ 
                display: "grid", 
                placeItems: "center", 
                width: 40, 
                height: 40, 
                borderRadius: 10, 
                background: "var(--bg)", 
                color: streaming ? "var(--accent)" : "var(--ink-muted)", 
                flex: "none",
                border: "1px solid var(--line)"
              }}>
                <Icon icon="solar:link-round-angle-linear" size={20} />
              </span>
              <input
                type="url"
                value={url}
                onChange={(e) => onUrlChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !disabled) onAnalyze(); }}
                placeholder="https://youtube.com/watch?v=..."
                aria-label="YouTube video URL"
                aria-invalid={status === "error"}
                aria-describedby={status === "error" ? "hero-error" : undefined}
                className="hx-field"
                style={{
                  minWidth: 0, 
                  flex: 1, 
                  background: "transparent", 
                  border: "none", 
                  outline: "none", 
                  padding: "0 4px", 
                  fontFamily: "var(--font-mono)", 
                  fontSize: 14, 
                  color: "var(--ink)" 
                }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                {status === "done" && (
                  <button
                    type="button"
                    onClick={onReanalyze}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      borderRadius: 10,
                      border: "1px solid var(--line)",
                      background: "transparent",
                      color: "var(--ink-secondary)",
                      padding: "12px 16px",
                      fontFamily: "var(--font-sans)",
                      fontSize: 14,
                      fontWeight: 500,
                      cursor: "pointer",
                      transition: "all var(--dur-fast)",
                    }}
                  >
                    <Icon icon="solar:refresh-linear" size={16} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onAnalyze}
                  disabled={disabled}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 10,
                    borderRadius: 10,
                    border: "none",
                    background: streaming ? "var(--bg)" : "var(--accent-strong)",
                    color: streaming ? "var(--accent)" : "var(--void)",
                    padding: "12px 20px",
                    fontFamily: "var(--font-sans)",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled && !streaming ? 0.4 : 1,
                    transition: "all var(--dur-fast)",
                    boxShadow: streaming ? "none" : "0 4px 14px var(--accent-glow)"
                  }}
                >
                  <Icon 
                    icon={streaming ? "solar:refresh-linear" : "solar:bolt-linear"} 
                    size={16} 
                    className={streaming ? "hx-anispin" : ""} 
                  />
                  {streaming ? "Analyzing" : "Analyze"}
                </button>
              </div>
            </div>
          </GlowBorder>
        </CornerFrame>
      </div>

      <div style={{ marginTop: 12, display: "flex", minHeight: 20, maxWidth: 640, alignItems: "center", justifyContent: "space-between", fontSize: 12 }}>
        <span id="hero-error" role="alert" aria-live="assertive" style={{ fontFamily: "var(--font-mono)", color: "var(--err)", fontWeight: 500 }}>{status === "error" ? error : ""}</span>
        {quota && <span style={{ fontFamily: "var(--font-mono)", color: "var(--ink-secondary)" }}>{quota}</span>}
      </div>
    </section>
  );
}
