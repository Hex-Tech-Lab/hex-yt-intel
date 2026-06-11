'use client';

import { ReactNode } from 'react';

// See /docs/ui/dashboard-layout.md

export interface DashboardLayoutProps {
  sidebar: ReactNode;
  topbar: ReactNode;
  children: ReactNode;
  rightPanel?: ReactNode;
  dock?: ReactNode;
}

export function DashboardLayout({ sidebar, topbar, children, rightPanel, dock }: DashboardLayoutProps) {
  return (
    <div className={`grid h-screen w-full min-w-[1024px] bg-[var(--bg)] text-[var(--ink)] overflow-hidden ${
      rightPanel ? "grid-cols-[260px_1fr_390px]" : "grid-cols-[260px_1fr]"
    }`}>
      <aside className="border-r border-[var(--line)] bg-[var(--void)] h-full w-[260px] flex-shrink-0 overflow-y-auto flex flex-col">
        {sidebar}
      </aside>

      <main className="relative flex flex-col h-full min-w-0 overflow-hidden isolate bg-[var(--bg)]">
        <header className="border-b border-[var(--line)] bg-[rgb(17_20_29_/_0.8)] backdrop-blur-md z-20">
          {topbar}
        </header>

        <div className="flex-1 overflow-y-auto p-8 px-10 pb-[72px] scroll-smooth">
          <div className="max-w-[1200px] mx-auto min-h-full flex flex-col">
            <div className="flex-1">
              {children}
            </div>
          </div>
        </div>

        {dock}
      </main>

      {rightPanel && (
        <aside className="border-l border-[var(--line)] bg-[var(--surface)] h-full w-[390px] flex-shrink-0 overflow-y-auto flex flex-col p-4 px-5">
          {rightPanel}
        </aside>
      )}
    </div>
  );
}
