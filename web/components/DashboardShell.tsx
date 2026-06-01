'use client';

import { ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { Navigation } from '@/components/organisms/Navigation';
import { Footer } from '@/components/Footer';
import { Toaster } from 'react-hot-toast';
import type { User } from '@supabase/supabase-js';

const AmbientCanvas = dynamic(() => import('@/components/ui/AmbientCanvas'), {
  ssr: false,
  loading: () => null,
});

interface DashboardShellProps {
  user: User;
  children: ReactNode;
}

export function DashboardShell({ user, children }: DashboardShellProps) {
  return (
    <div className="relative w-full min-h-screen bg-surface text-primary antialiased">
      {/* Ambient Canvas Background (z-0) */}
      <AmbientCanvas className="absolute inset-0 z-0 opacity-40" />

      {/* Main Content (z-10) */}
      <div className="relative z-10 flex flex-col min-h-screen">
        {/* Navigation */}
        <Navigation user={user} />

        {/* Main Content Area */}
        <main className="flex-1 overflow-hidden">
          {children}
        </main>

        {/* Footer */}
        <Footer />
      </div>

      {/* Toast Notifications */}
      <Toaster position="bottom-right" />
    </div>
  );
}
