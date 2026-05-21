'use client';

import { SessionProvider } from 'next-auth/react';
import '../sentry.client.config';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {children}
    </SessionProvider>
  );
}
