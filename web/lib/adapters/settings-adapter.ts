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
 * Uses client-side Supabase (admin_settings is readable by authenticated users per RLS policy).
 */
export async function fetchAdminSettings(): Promise<AdminSettings> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('admin_settings')
      .select('*')
      .eq('id', 'default')
      .maybeSingle();

    // maybeSingle() returns { data: null, error: null } for zero rows (normal on
    // first setup) instead of PostgREST's 406 + PGRST116 that .single() throws --
    // same fallback-to-defaults behavior below, without the noisy network error.
    if (error) {
      throw error;
    }

    if (data) {
      return {
        id: data.id,
        totalDimensions: data.total_dimensions,
        minUsableDimensions: data.min_usable_dimensions,
        streamBundles: data.stream_bundles,
        dimensionConfigs: data.dimension_configs,
        modelCascade: data.model_cascade,
        connectionHandshakeTimeoutMs: data.connection_handshake_timeout_ms,
        tokenStreamingWindowMs: data.token_streaming_window_ms,
        maxRetries: data.max_retries,
        retryBackoffMs: data.retry_backoff_ms,
        abortOnPartialFailure: data.abort_on_partial_failure,
        created_at: data.created_at,
        updated_at: data.updated_at,
      } as AdminSettings;
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
      .maybeSingle();

    // maybeSingle() returns { data: null, error: null } for zero rows instead of
    // PostgREST's 406 + PGRST116 that .single() throws -- same fallback-to-null
    // behavior below (caller uses defaults), without the noisy network error.
    if (error) {
      throw error;
    }

    if (!data) {
      console.debug('[fetchUserSettings] No user_settings found for user', { userId });
      return null;
    }

    return {
      id: data.id,
      userId: data.user_id,
      preferredModel: data.preferred_model,
      analysisDetailLevel: data.analysis_detail_level,
      autoSaveAnalyses: data.auto_save_analyses,
      notificationsEnabled: data.notifications_enabled,
      created_at: data.created_at,
      updated_at: data.updated_at,
    } as UserSettings;
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

    const mappedSettings: Record<string, any> = {
      user_id: userId,
      updated_at: now,
    };

    // Map camelCase UserSettings fields to snake_case DB columns
    if ('preferredModel' in settings) mappedSettings.preferred_model = settings.preferredModel;
    if ('analysisDetailLevel' in settings) mappedSettings.analysis_detail_level = settings.analysisDetailLevel;
    if ('autoSaveAnalyses' in settings) mappedSettings.auto_save_analyses = settings.autoSaveAnalyses;
    if ('notificationsEnabled' in settings) mappedSettings.notifications_enabled = settings.notificationsEnabled;

    const { data, error } = await supabase
      .from('user_settings')
      .upsert(mappedSettings, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) throw error;
    console.debug('[upsertUserSettings] User settings updated successfully', { userId });

    return {
      id: data.id,
      userId: data.user_id,
      preferredModel: data.preferred_model,
      analysisDetailLevel: data.analysis_detail_level,
      autoSaveAnalyses: data.auto_save_analyses,
      notificationsEnabled: data.notifications_enabled,
      created_at: data.created_at,
      updated_at: data.updated_at,
    } as UserSettings;
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
