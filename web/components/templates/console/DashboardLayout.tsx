'use client';

import { ReactNode } from 'react';

export interface DashboardLayoutProps {
  sidebar: ReactNode;
  topbar: ReactNode;
  children: ReactNode;
  /** Right-side panel (Intelligence rail, graph, etc.) — full-height sticky column. */
  rightPanel?: ReactNode;
  /** Bottom-anchored dock spanning the main content column (between left nav and right panel). */
  dock?: ReactNode;
}

export function DashboardLayout({ sidebar, topbar, children, rightPanel, dock }: DashboardLayoutProps) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: rightPanel ? "260px 1fr 390px" : "260px 1fr",
      width: "100%",
      minWidth: 1024,
      height: "100vh",
      background: "var(--bg)",
      color: "var(--ink)",
      overflow: "hidden"
    }}>
      <aside style={{
        borderRight: "1px solid var(--line)",
        background: "var(--void)",
        height: "100%",
        width: 260,
        minWidth: 260,
        flexShrink: 0,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column"
      }}>
        {sidebar}
      </aside>

      <main style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minWidth: 0,
        overflow: "hidden"
      }}>
        <header style={{
          borderBottom: "1px solid var(--line)",
          background: "rgb(17 20 29 / 0.8)",
          backdropFilter: "blur(12px)",
          zIndex: 20
        }}>
          {topbar}
        </header>

        <div style={{
          flex: 1,
          overflowY: "auto",
          // Bottom padding clears the collapsed chat dock bar on every tab.
          padding: "32px 40px 72px",
          scrollBehavior: "smooth"
        }}>
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            {children}
          </div>
        </div>

        {/* Bottom-anchored dock — trapped between left nav and right panel */}
        {dock}
      </main>

      {/* Right panel: full-height, sticky (Intelligence rail, graph, etc.) */}
      {rightPanel && (
        <aside style={{
          borderLeft: "1px solid var(--line)",
          background: "var(--surface)",
          height: "100%",
          width: 390,
          minWidth: 390,
          flexShrink: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          padding: "16px 20px"
        }}>
          {rightPanel}
        </aside>
      )}
    </div>
  );
}
