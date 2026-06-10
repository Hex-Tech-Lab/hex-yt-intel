'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MonoLabel } from '@/components/templates/_shared/primitives';

/**
 * SYSTEM STATUS DASHBOARD - "Infrastructure Transparency" Look
 * ----------------------------------------------------------
 * High-density uptime grid (90 days) inspired by Stripe/Cloudflare.
 * Features 8 anonymous subsystems with hover state interactions.
 */

interface Subsystem {
  id: string;
  name: string;
  status: 'operational' | 'degraded' | 'outage';
  uptime: number;
}

const SUBSYSTEMS: Subsystem[] = [
  { id: "S1", name: "Synthesis Engine Core", status: 'operational', uptime: 99.98 },
  { id: "S2", name: "Vector Index Gateway", status: 'operational', uptime: 100 },
  { id: "S3", name: "Streaming Buffer (Global)", status: 'operational', uptime: 99.95 },
  { id: "S4", name: "Persistence Layer (Relational)", status: 'operational', uptime: 99.99 },
  { id: "S5", name: "Edge Execution (Vercel)", status: 'operational', uptime: 100 },
  { id: "S6", name: "Authentication Service", status: 'operational', uptime: 100 },
  { id: "S7", name: "Billing Webhook Orchestrator", status: 'operational', uptime: 99.90 },
  { id: "S8", name: "API Rate Limiting", status: 'operational', uptime: 100 },
];

function UptimeBar({ day, status }: { day: number, status: 'ok' | 'warn' | 'err' }) {
  const [hovered, setHovered] = useState(false);
  
  const colorMap = {
    ok: "var(--ok)",
    warn: "var(--warn)",
    err: "var(--err)"
  };

  return (
    <div 
      style={{ 
        position: "relative",
        flex: 1, 
        height: 28, 
        background: colorMap[status],
        opacity: hovered ? 1 : 0.7,
        borderRadius: 2,
        transition: "all 0.2s"
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && (
        <div style={{
          position: "absolute",
          bottom: "100%",
          left: "50%",
          transform: "translateX(-50%)",
          marginBottom: 8,
          background: "var(--surface)",
          border: "1px solid var(--line)",
          padding: "6px 10px",
          borderRadius: 6,
          zIndex: 10,
          whiteSpace: "nowrap",
          boxShadow: "0 10px 15px -3px rgba(0,0,0,0.5)"
        }}>
          <p style={{ margin: 0, fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--ink-muted)" }}>
            June {Math.max(1, 10 - (90 - day))}, 2026
          </p>
          <p style={{ margin: "2px 0 0", fontSize: 11, fontWeight: 600, color: status === 'ok' ? "var(--ok)" : "var(--warn)" }}>
            {status === 'ok' ? 'System Operational' : status === 'warn' ? 'Minor Degradation' : 'Partial Outage'}
          </p>
        </div>
      )}
    </div>
  );
}

export default function HealthDashboard() {
  return (
    <div style={{ background: "var(--void)", color: "var(--ink)", minHeight: "100vh", padding: "80px 32px" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 48 }}>
          <div>
            <MonoLabel index="//">Infrastructure Transparency</MonoLabel>
            <h1 className="hx-display" style={{ margin: "12px 0 0", fontSize: 36 }}>System Status</h1>
          </div>
          <div style={{ textAlign: "right" }}>
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              borderRadius: 9999,
              background: "rgb(16 185 129 / 0.1)",
              border: "1px solid var(--ok)",
              padding: "6px 14px",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--ok)",
              textTransform: "uppercase",
              letterSpacing: "0.05em"
            }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ok)", animation: "hx-pulse 1.5s infinite" }} />
              All Systems Operational
            </span>
          </div>
        </div>

        {/* Subsystems List */}
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          {SUBSYSTEMS.map((sub) => (
            <div key={sub.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>{sub.name}</h3>
                <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--ok)" }}>{sub.uptime}% Uptime</span>
              </div>
              
              {/* 90-day Barcode Grid */}
              <div style={{ display: "flex", gap: 3 }}>
                {Array.from({ length: 90 }).map((_, i) => (
                  <UptimeBar key={i} day={i} status={i === 42 || i === 78 ? 'warn' : 'ok'} />
                ))}
              </div>
              
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--ink-muted)", textTransform: "uppercase" }}>
                <span>90 days ago</span>
                <span style={{ width: "1px", height: 8, background: "var(--line)" }} />
                <span>Today</span>
              </div>
            </div>
          ))}
        </div>

        {/* Footer info */}
        <div style={{ marginTop: 80, padding: 32, borderTop: "1px solid var(--line)", textAlign: "center" }}>
          <p style={{ fontSize: 13, color: "var(--ink-secondary)" }}>
            Real-time data provided by our observability cluster.
          </p>
          <div style={{ marginTop: 16, display: "flex", justifyContent: "center", gap: 24 }}>
            <Link href="/dashboard" style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}>Back to Console</Link>
            <a href="/api/health?format=json" style={{ fontSize: 12, color: "var(--ink-muted)", textDecoration: "none" }}>View Programmatic JSON</a>
          </div>
        </div>

      </div>

      <style jsx global>{`
        @keyframes hx-pulse {
          0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
          70% { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); }
          100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }
      `}</style>
    </div>
  );
}
