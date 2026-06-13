'use client';

import { useEffect, useRef, useState } from 'react';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { Icon } from '@/components/templates/_shared/primitives';

export interface ProcessingLogProps {
  status: 'idle' | 'streaming' | 'done' | 'error';
}

export function ProcessingLog({ status }: ProcessingLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { terminalLines } = useAnalysisStore();
  const [collapsed, setCollapsed] = useState(false);

  // Auto-expand when a new stream starts so the user sees live output.
  useEffect(() => {
    if (status === 'streaming') setCollapsed(false);
  }, [status]);

  useEffect(() => {
    if (scrollRef.current && !collapsed) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [terminalLines, collapsed]);

  return (
    <div style={{
      border: "1px solid var(--line)",
      borderRadius: "12px",
      overflow: "hidden",
      background: "rgb(11 14 20 / 0.96)",
      backdropFilter: "blur(12px)",
      boxShadow: "0 4px 20px -5px rgba(0,0,0,0.5)",
    }}>
      {/* Title Bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 14px",
        borderBottom: "1px solid var(--line)",
        background: "rgb(26 31 43 / 0.7)"
      }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "rgb(239 68 68 / 0.8)" }} />
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "rgb(245 158 11 / 0.8)" }} />
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "rgb(34 197 94 / 0.8)" }} />
          <span style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--ink-muted)",
            marginLeft: 8
          }}>
            synthesis.log
          </span>
        </div>
        
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {status === 'streaming' && (
            <span style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--accent-ink)",
              display: "flex",
              alignItems: "center",
              gap: 4
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", animation: "hx-blink 1.2s infinite" }} />
              LIVE
            </span>
          )}
          {collapsed && terminalLines.length > 0 && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-muted)" }}>
              {terminalLines.length} lines
            </span>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand processing log' : 'Collapse processing log'}
            aria-expanded={!collapsed}
            style={{
              display: "grid",
              placeItems: "center",
              width: 22,
              height: 22,
              borderRadius: 6,
              border: "1px solid var(--line)",
              background: "transparent",
              color: "var(--ink-secondary)",
              cursor: "pointer",
              transition: "all 0.15s ease"
            }}
          >
            <Icon icon={collapsed ? 'solar:alt-arrow-up-linear' : 'solar:alt-arrow-down-linear'} size={12} />
          </button>
        </div>
      </div>

      {/* Terminal Lines Container */}
      {!collapsed && (
        <div
          ref={scrollRef}
          className="hx-custom-scrollbar"
          style={{
            padding: "10px 14px",
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            lineHeight: 1.6,
            maxHeight: 160,
            overflowY: "auto",
            scrollBehavior: "smooth"
          }}
        >
          {terminalLines.length === 0 ? (
            <div style={{ color: "var(--ink-muted)", fontStyle: "italic", fontSize: 11 }}>
              Initializing analysis pipeline...
            </div>
          ) : (
            terminalLines.map((line, i) => (
              <div key={i} style={{ display: "flex", gap: 12, marginBottom: 2 }}>
                <span style={{ color: "var(--ink-muted)", flexShrink: 0 }}>[{line.timestamp}]</span>
                <span style={{
                  color: line.type === 'ok' ? "var(--ok)" :
                         line.type === 'error' ? "var(--err)" :
                         "var(--ink-secondary)",
                  wordBreak: "break-all"
                }}>
                  {line.message}
                </span>
              </div>
            ))
          )}
          {status === 'streaming' && (
            <div style={{ marginTop: 2 }}>
              <span style={{
                display: "inline-block",
                width: 6,
                height: 12,
                background: "var(--accent)",
                verticalAlign: -1.5,
                animation: "hx-blink 1s step-end infinite"
              }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
