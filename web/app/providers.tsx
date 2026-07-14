'use client';

import '../sentry.client.config';
import { SettingsProvider } from '@/lib/stores/settings-context';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>
      {children}
    </SettingsProvider>
  );
}
