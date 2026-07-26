'use client';

import '../sentry.client.config';
import { LayerProvider } from '@astryxdesign/core';
import { SettingsProvider } from '@/lib/stores/settings-context';
import { ToastBridge } from '@/lib/dashboard/toast-bridge';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>
      <LayerProvider toast={{ position: 'bottomEnd' }}>
        {children}
        <ToastBridge />
      </LayerProvider>
    </SettingsProvider>
  );
}
