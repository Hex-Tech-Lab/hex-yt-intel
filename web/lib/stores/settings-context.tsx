/**
 * React context for settings (admin + user).
 * Provides single source of truth for all configuration values app-wide.
 */

'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import * as Sentry from '@sentry/nextjs';
import { useAuth } from '@/hooks/useAuth';
import { fetchAdminSettings, fetchUserSettings } from '@/lib/adapters/settings-adapter';
import type { AdminSettings, UserSettings, SettingsContextValue } from '@/lib/types/settings';

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const [adminSettings, setAdminSettings] = useState<AdminSettings | null>(null);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  // Network-storms dedupe (2026-09-26): React Strict Mode's dev-only
  // mount->cleanup->remount double-invokes this effect, firing the
  // identical admin_settings + user_settings Supabase queries twice on
  // every mount. An in-flight load for the SAME user key is shared instead
  // of restarted (refs survive the double invoke; it is the same
  // component instance).
  const inFlightForRef = useRef<string | null>(null);
  // Guard against applying a load's results after the user key changed
  // mid-flight (e.g. logout during the load): a stale load must never
  // overwrite the state that the newer effect run is responsible for.
  const activeUserKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    const userKey = user?.id ?? null;
    activeUserKeyRef.current = userKey;
    if (inFlightForRef.current === userKey) return;

    const loadSettings = async () => {
      const apply = () => activeUserKeyRef.current === userKey;
      try {
        if (apply()) {
          setIsLoading(true);
          setError(null);
        }

        // Admin settings are always loaded
        const admin = await fetchAdminSettings();
        if (!apply()) return;
        setAdminSettings(admin);

        // User settings only if logged in; clear when logged out
        if (user?.id) {
          const userSettings = await fetchUserSettings(user.id);
          if (!apply()) return;
          setUserSettings(userSettings);
        } else {
          if (!apply()) return;
          setUserSettings(null);
        }
      } catch (err) {
        if (!apply()) return;
        Sentry.captureException(err, {
          contexts: { settings: { module: 'settings-context', function: 'loadSettings' } },
        });
        setError(err instanceof Error ? err : new Error('Failed to load settings'));
      } finally {
        if (apply()) setIsLoading(false);
        // Only clear OUR marker -- a superseded load must not clobber a
        // newer run's in-flight marker.
        if (inFlightForRef.current === userKey) inFlightForRef.current = null;
      }
    };

    // Only load after auth is done loading
    if (!authLoading) {
      inFlightForRef.current = userKey;
      loadSettings();
    }
  }, [user?.id, authLoading]);

  const value: SettingsContextValue = {
    adminSettings,
    userSettings,
    isLoading,
    error,
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

/**
 * Hook to access settings context.
 * Must be used within SettingsProvider.
 */
export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within SettingsProvider');
  }
  return context;
}

/**
 * Convenience hook to access admin settings directly.
 */
export function useAdminSettings(): AdminSettings | null {
  const { adminSettings } = useSettings();
  return adminSettings;
}

/**
 * Convenience hook to access user settings directly.
 */
export function useUserSettings(): UserSettings | null {
  const { userSettings } = useSettings();
  return userSettings;
}
