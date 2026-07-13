/**
 * React context for settings (admin + user).
 * Provides single source of truth for all configuration values app-wide.
 */

'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
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

  useEffect(() => {
    const loadSettings = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Admin settings are always loaded
        const admin = await fetchAdminSettings();
        setAdminSettings(admin);

        // User settings only if logged in; clear when logged out
        if (user?.id) {
          const userSettings = await fetchUserSettings(user.id);
          setUserSettings(userSettings);
        } else {
          setUserSettings(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to load settings'));
      } finally {
        setIsLoading(false);
      }
    };

    // Only load after auth is done loading
    if (!authLoading) {
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
