'use client';

import { useEffect, useRef } from 'react';
import { MonoLabel } from '@/components/templates/_shared/primitives';

export interface LogLine {
  timestamp: string;
  type: 'info' | 'ok' | 'warn' | 'error';
  message: string;
}

export interface ProcessingLogProps {
  lines: LogLine[];
  status: 'idle' | 'streaming' | 'done' | 'error';
}

export function ProcessingLog({ lines, status }: ProcessingLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div style={{ marginTop: 24 }}>
      <MonoLabel index="//">processing log · terminal output</MonoLabel>
      
      <div style={{
        marginTop: 12,
        border: "1px solid var(--line)",
        borderRadius: 14,
        overflow: "hidden",
        background: "rgb(11 14 20 / 0.8)",
        backdropFilter: "blur(8px)"
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 13px",
          borderBottom: "1px solid var(--line)",
          background: "rgb(26 31 43 / 0.6)"
        }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "rgb(239 68 68 / 0.7)" }} />
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "rgb(245 158 11 / 0.7)" }} />
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "rgb(34 197 94 / 0.7)" }} />
            <span style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--ink-muted)",
              marginLeft: 8
            }}>
              synthesis.log
            </span>
          </div>
          {status === 'streaming' && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--accent-ink)" }}>
              ● live
            </span>
          )}
        </div>

        <div
          ref={scrollRef}
          style={{
            padding: "11px 13px",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            lineHeight: 1.7,
            maxHeight: 240,
            overflowY: "auto",
            scrollBehavior: "smooth"
          }}
        >
          {lines.map((line, i) => (
            <div key={i} style={{ display: "flex", gap: 12 }}>
              <span style={{ color: "var(--ink-muted)" }}>{line.timestamp}</span>
              <span style={{
                color: line.type === 'ok' ? "var(--ok)" :
                       line.type === 'warn' ? "var(--warn)" :
                       line.type === 'error' ? "var(--err)" :
                       "var(--ink-secondary)"
              }}>
                {line.message}
              </span>
            </div>
          ))}
          {status === 'streaming' && (
            <div>
              <span style={{
                display: "inline-block",
                width: 7,
                height: 13,
                background: "var(--accent)",
                verticalAlign: -2,
                animation: "hx-blink 1s step-end infinite"
              }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
