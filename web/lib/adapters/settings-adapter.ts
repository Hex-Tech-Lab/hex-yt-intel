/**
 * Database adapter for settings (admin and user).
 * Provides functions to fetch and update settings from Supabase.
 * Settings are cached in context to avoid repeated database hits.
 */

import { createClient } from '@/utils/supabase/client';
import * as Sentry from '@sentry/nextjs';
import type { AdminSettings, UserSettings } from '@/lib/types/settings';

/**
 * Fetch admin settings (singleton - only one exists).
 * Returns default settings if none exist in the database.
 * Uses client-side Supabase (admin_settings is publicly readable per RLS policy).
 */
export async function fetchAdminSettings(): Promise<AdminSettings> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('admin_settings')
      .select('*')
      .eq('id', 'default')
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows returned (normal on first setup)
      throw error;
    }

    if (data) {
      return data as AdminSettings;
    }

    // Return hardcoded defaults if no settings in DB yet
    console.debug('[fetchAdminSettings] No admin_settings in database, using defaults');
    return getDefaultAdminSettings();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, {
      contexts: { adapter: { operation: 'fetchAdminSettings' } },
      tags: { type: 'settings-adapter' },
    });
    console.error('[fetchAdminSettings] Failed to fetch admin settings, using defaults', { error: msg });
    return getDefaultAdminSettings();
  }
}

/**
 * Fetch user settings for a specific user.
 * Returns default/empty settings if none exist.
 * Uses client-side Supabase (user can only read their own settings per RLS policy).
 */
export async function fetchUserSettings(userId: string): Promise<UserSettings | null> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (!data) {
      console.debug('[fetchUserSettings] No user_settings found for user', { userId });
    }
    return data as UserSettings | null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, {
      contexts: { adapter: { operation: 'fetchUserSettings', userId } },
      tags: { type: 'settings-adapter' },
    });
    console.error('[fetchUserSettings] Failed to fetch user settings', { userId, error: msg });
    return null;
  }
}

/**
 * Create or update user settings.
 * Uses client-side Supabase (user can only write their own settings per RLS policy).
 */
export async function upsertUserSettings(userId: string, settings: Partial<UserSettings>): Promise<UserSettings | null> {
  try {
    const supabase = createClient();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('user_settings')
      .upsert(
        {
          user_id: userId,
          ...settings,
          updated_at: now,
        },
        { onConflict: 'user_id' }
      )
      .select()
      .single();

    if (error) throw error;
    console.debug('[upsertUserSettings] User settings updated successfully', { userId });
    return data as UserSettings;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, {
      contexts: { adapter: { operation: 'upsertUserSettings', userId, settingsKeys: Object.keys(settings) } },
      tags: { type: 'settings-adapter' },
    });
    console.error('[upsertUserSettings] Failed to upsert user settings', { userId, error: msg });
    return null;
  }
}

/**
 * Default admin settings (used as fallback if DB is empty).
 * These values should eventually be persisted in admin_settings table.
 */
function getDefaultAdminSettings(): AdminSettings {
  return {
    id: 'default',
    totalDimensions: 11,
    minUsableDimensions: 8,
    streamBundles: [
      { dimensions: [1] }, // Apex (largest, has persona)
      { dimensions: [8] }, // Semantic / KG (large, has knowledgeGraph)
      { dimensions: [2, 4, 6] }, // Provenance, Psychological, Comparative
      { dimensions: [5, 7, 10] }, // CoreIntel, Implementation, Credibility
      { dimensions: [3, 9, 11] }, // Architecture, Forward, Monetization
    ],
    dimensionConfigs: {
      0: { number: 0, name: 'EXECUTIVE DIGEST' },
      1: { number: 1, name: 'APEX INTELLIGENCE', extraFields: ['persona'] },
      2: { number: 2, name: 'PROVENANCE, METADATA & VIRALITY PROFILE' },
      3: { number: 3, name: 'CONTENT ARCHITECTURE & FIRST PRINCIPLES' },
      4: { number: 4, name: 'PSYCHOLOGICAL & RHETORICAL LAYER' },
      5: { number: 5, name: 'CORE INTELLIGENCE EXTRACTION' },
      6: { number: 6, name: 'COMPARATIVE & QUANTITATIVE ANALYSIS' },
      7: { number: 7, name: 'IMPLEMENTATION SYSTEMS & WORKFLOWS' },
      8: { number: 8, name: 'SEMANTIC & KNOWLEDGE GRAPH FOUNDATION', extraFields: ['knowledgeGraph'] },
      9: { number: 9, name: 'FORWARD INTELLIGENCE & STRATEGIC FORESIGHT' },
      10: { number: 10, name: 'CREDIBILITY, RISK & META-ASSESSMENT' },
      11: { number: 11, name: 'COMMERCIAL YIELD & MONETIZATION PROFILING', extraFields: ['classification', 'monetizationVerdict'] },
    },
    modelCascade: ['nemotron-3-nano', 'claude-haiku-4-5'],
    connectionHandshakeTimeoutMs: 3000,
    tokenStreamingWindowMs: 25000, // Vercel default
    maxRetries: 3,
    retryBackoffMs: 1000,
    abortOnPartialFailure: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
