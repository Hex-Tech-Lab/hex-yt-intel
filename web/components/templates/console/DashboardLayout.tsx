'use client';

import { ReactNode } from 'react';
import { useUIStore } from '@/store/useUIStore';

// See /docs/ui/dashboard-layout.md

export interface DashboardLayoutProps {
  sidebar: ReactNode;
  topbar: ReactNode;
  children: ReactNode;
  rightPanel?: ReactNode;
  dock?: ReactNode;
}

export function DashboardLayout({ sidebar, topbar, children, rightPanel, dock }: DashboardLayoutProps) {
  const isAnyOverlayOpen = useUIStore((s) => s.isAnyOverlayOpen);

  return (
    <div className={`grid min-h-screen lg:h-screen w-full max-w-full bg-[var(--void)] text-[var(--ink)] overflow-x-hidden overflow-y-auto lg:overflow-hidden gap-2 p-2 grid-cols-1 ${
      rightPanel ? "lg:grid-cols-[260px_1fr_390px]" : "lg:grid-cols-[260px_1fr]"
    }`}>
      <aside
        inert={isAnyOverlayOpen ? true : undefined}
        className="border border-[var(--line)] bg-[var(--void)] h-auto lg:h-full w-full max-h-[45vh] lg:max-h-none flex-shrink-0 overflow-y-auto flex flex-col rounded-xl"
      >
        {sidebar}
      </aside>

      <main
        inert={isAnyOverlayOpen ? true : undefined}
        className="relative flex flex-col h-auto lg:h-full min-w-0 min-h-[70vh] lg:min-h-0 overflow-hidden bg-[var(--bg)] border border-[var(--line)] rounded-xl"
      >
        <header className="border-b border-[var(--line)] bg-[rgb(17_20_29_/_0.8)] backdrop-blur-md z-20">
          {topbar}
        </header>

        <div className="flex-1 overflow-y-auto p-4 lg:p-6 lg:px-8 scroll-smooth">
          <div className="max-w-[1200px] mx-auto min-h-full flex flex-col">
            <div className="flex-1">
              {children}
            </div>
          </div>
        </div>

        {dock}
      </main>

      {rightPanel && (
        <aside
          inert={isAnyOverlayOpen ? true : undefined}
          className="border border-[var(--line)] bg-[var(--surface)] h-auto lg:h-full w-full max-h-[55vh] lg:max-h-none flex-shrink-0 overflow-y-auto flex flex-col p-3 px-4 rounded-xl"
        >
          {rightPanel}
        </aside>
      )}
    </div>
  );
}
