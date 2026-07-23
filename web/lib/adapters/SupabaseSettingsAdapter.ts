import { getSupabaseServiceClient } from '@/lib/supabase';
import * as Sentry from '@sentry/nextjs';
import type { SettingsPersistencePort } from '@/lib/ports';
import type { KnowledgeWikiPort } from '@/lib/services/KnowledgeHistoryService';

/**
 * SupabaseSettingsAdapter handles:
 * - Application-wide settings (feature flags, config, etc.)
 * - User knowledge wiki storage and retrieval (KnowledgeWikiPort)
 *
 * This adapter isolates settings and wiki persistence from analysis/chat/graph concerns,
 * following the Single Responsibility Principle.
 *
 * Implements: SettingsPersistencePort, KnowledgeWikiPort
 */
export class SupabaseSettingsAdapter
  implements SettingsPersistencePort, KnowledgeWikiPort
{
  /**
   * Fetch an application setting by key.
   * Returns null if the setting does not exist.
   */
  getAppSetting(key: string): Promise<any | null> {
    return SupabaseSettingsAdapter.getAppSettingStatic(key);
  }

  /**
   * KnowledgeWikiPort implementation: Load user's knowledge wiki rows.
   * Queries public.user_knowledge_wiki table for all topics belonging to userId.
   * Returns empty array if user has no wiki history.
   */
  getUserWiki(userId: string): Promise<
    Array<{
      id: string;
      user_id: string;
      topic: string;
      wiki_markdown: string;
      question_count: number;
      theme_count: number;
      created_at: string;
      updated_at: string;
    }>
  > {
    return SupabaseSettingsAdapter.getUserWikiStatic(userId);
  }

  // Static methods for use by facade pattern adapters

  // In-process cache for the (Wave D1) settings registry -- read on every
  // analysis kickoff (CreateAnalysisUseCase), so a per-instance TTL cache
  // avoids a DB round trip per request for values that change rarely. Scoped
  // to the module, not per-request; a Vercel instance is short-lived enough
  // (and the values low-stakes enough) that this is a reasonable tradeoff
  // over adding a Redis round trip for the same purpose.
  private static registryCache = new Map<string, { value: unknown; expiresAt: number }>();
  private static readonly REGISTRY_CACHE_TTL_MS = 60_000;

  /**
   * Resolve a set of registry keys (setting_definitions/setting_values, Wave
   * D1) to their live system-scope values, falling back to each key's
   * `default_value` when no override row exists, and to `fallback` (a value
   * the CALLER must keep in sync with the migration's seeded default) only if
   * the registry itself is unreachable. This is the one place worker-bound
   * config should be resolved from -- never hardcode the tunable directly at
   * the call site.
   */
  static async getRegistrySettings<T extends Record<string, unknown>>(
    keys: string[],
    fallback: T
  ): Promise<T> {
    const now = Date.now();
    const uncached = keys.filter((k) => {
      const cached = SupabaseSettingsAdapter.registryCache.get(k);
      return !cached || cached.expiresAt < now;
    });

    if (uncached.length > 0) {
      try {
        const service = getSupabaseServiceClient();
        const [{ data: defs, error: defErr }, { data: vals, error: valErr }] = await Promise.all([
          service.from('setting_definitions').select('key, default_value').in('key', uncached),
          service.from('setting_values').select('setting_key, value').eq('scope_type', 'system').is('scope_id', null).in('setting_key', uncached),
        ]);
        if (defErr || valErr) throw defErr || valErr;

        const overrides = new Map((vals ?? []).map((v) => [v.setting_key, v.value]));
        for (const def of defs ?? []) {
          const resolved = overrides.has(def.key) ? overrides.get(def.key) : def.default_value;
          SupabaseSettingsAdapter.registryCache.set(def.key, { value: resolved, expiresAt: now + SupabaseSettingsAdapter.REGISTRY_CACHE_TTL_MS });
        }
      } catch (error) {
        console.warn('[SupabaseSettingsAdapter] getRegistrySettings failed, using fallback defaults:', error instanceof Error ? error.message : String(error));
        Sentry.captureException(error, { tags: { method: 'getRegistrySettings' }, extra: { keys: uncached } });
        // Do not cache the fallback -- retry the DB on the next call rather
        // than pinning a stale/degraded value for the full TTL.
      }
    }

    const result = { ...fallback };
    for (const key of keys) {
      const cached = SupabaseSettingsAdapter.registryCache.get(key);
      if (cached) (result as Record<string, unknown>)[key] = cached.value;
    }
    return result;
  }

  static async getAppSettingStatic(key: string): Promise<any | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('app_settings')
        .select('value')
        .eq('key', key)
        .single();
      if (error) {
        console.error('[SupabaseSettingsAdapter] getAppSetting failed:', error.message);
        Sentry.captureException(error, {
          tags: { method: 'getAppSetting' },
          extra: { key },
        });
        return null;
      }
      return data.value;
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { method: 'getAppSetting' },
        extra: { key },
      });
      return null;
    }
  }

  static async getUserWikiStatic(userId: string): Promise<
    Array<{
      id: string;
      user_id: string;
      topic: string;
      wiki_markdown: string;
      question_count: number;
      theme_count: number;
      created_at: string;
      updated_at: string;
    }>
  > {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('user_knowledge_wiki')
        .select(
          'id, user_id, topic, wiki_markdown, question_count, theme_count, created_at, updated_at'
        )
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('[SupabaseSettingsAdapter] getUserWiki failed:', error.message);
        Sentry.captureException(error, {
          tags: { method: 'getUserWiki' },
          extra: { userId },
        });
        return [];
      }

      return data || [];
    } catch (error: unknown) {
      console.error('[SupabaseSettingsAdapter] getUserWiki error:', error);
      Sentry.captureException(error, {
        tags: { method: 'getUserWiki' },
        extra: { userId },
      });
      return [];
    }
  }
}
