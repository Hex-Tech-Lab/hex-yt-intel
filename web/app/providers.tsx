'use client';

import '../sentry.client.config';
import { LayerProvider, Theme } from '@astryxdesign/core';
import { neutralTheme } from '@astryxdesign/theme-neutral';
import { SettingsProvider } from '@/lib/stores/settings-context';
import { ToastBridge } from '@/lib/dashboard/toast-bridge';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>
      {/*
        Real bug fix (2026-08-20): the app set `data-theme="dark"` on <html>
        by hand (app/layout.tsx) but never rendered Astryx's own `<Theme>`
        provider. Astryx's generated theme.css scopes ALL of its component
        styling under `@scope ([data-astryx-theme="neutral"]) to
        ([data-astryx-theme])` -- without a root Theme syncing that attribute
        to <html>, portal-rendered components (Toast's ToastViewport
        specifically) fall back to unstyled/default (white) colors, even
        though same-tree components look fine via the app's own Tailwind/CSS
        vars. <Theme> is the library's own documented fix: as the first
        Theme in the tree it syncs both data-theme and data-astryx-theme to
        document.documentElement, which is exactly what portalled content
        needs to pick up the real dark palette.
      */}
      <Theme theme={neutralTheme} mode="dark">
        <LayerProvider toast={{ position: 'bottomEnd' }}>
          {children}
          <ToastBridge />
        </LayerProvider>
      </Theme>
    </SettingsProvider>
  );
}
