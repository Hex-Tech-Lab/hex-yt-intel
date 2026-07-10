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
