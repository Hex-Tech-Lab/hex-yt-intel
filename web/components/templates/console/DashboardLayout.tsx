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
    <div className={`grid h-screen w-full max-w-full bg-[var(--void)] text-[var(--ink)] overflow-hidden gap-[4px] p-[4px] ${
      rightPanel ? "grid-cols-[260px_1fr_390px]" : "grid-cols-[260px_1fr]"
    }`}>
      <aside 
        inert={isAnyOverlayOpen ? true : undefined}
        className="border border-[var(--line)] bg-[var(--void)] h-full w-[260px] flex-shrink-0 overflow-y-auto flex flex-col rounded-xl"
      >
        {sidebar}
      </aside>

      <main 
        inert={isAnyOverlayOpen ? true : undefined}
        className="relative flex flex-col h-full min-w-[320px] overflow-hidden bg-[var(--bg)] border border-[var(--line)] rounded-xl"
      >
        <header className="border-b border-[var(--line)] bg-[rgb(17_20_29_/_0.8)] backdrop-blur-md z-20">
          {topbar}
        </header>

        <div className="flex-1 overflow-y-auto p-8 pb-8 px-10 scroll-smooth">
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
          className="border border-[var(--line)] bg-[var(--surface)] h-full w-[390px] flex-shrink-0 overflow-y-auto flex flex-col p-4 px-5 rounded-xl"
        >
          {rightPanel}
        </aside>
      )}
    </div>
  );
}
