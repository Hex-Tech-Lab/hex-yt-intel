'use client';

import { SessionProvider } from 'next-auth/react';
import React from 'react';
import { ClientOnly } from '@/components/ClientOnly';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ClientOnly>
      <SessionProvider>{children}</SessionProvider>
    </ClientOnly>
  );
}
