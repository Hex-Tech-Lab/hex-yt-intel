'use client';

import { ReactNode } from 'react';

export interface DashboardLayoutProps {
  sidebar: ReactNode;
  topbar: ReactNode;
  children: ReactNode;
}

export function DashboardLayout({ sidebar, topbar, children }: DashboardLayoutProps) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "260px 1fr",
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
          padding: "32px 40px",
          scrollBehavior: "smooth"
        }}>
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
