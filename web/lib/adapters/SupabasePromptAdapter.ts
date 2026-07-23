import { getSupabaseServiceClient } from '@/lib/supabase';
import * as Sentry from '@sentry/nextjs';

/**
 * Resolves LLM system prompts from the Vault-backed prompt registry (Wave D3,
 * migration 20260723200000) instead of a hardcoded TS string constant. Prompt
 * text is stored encrypted at rest via supabase_vault (pgsodium) -- read back
 * only through vault.decrypted_secrets, which is service-role-only by
 * Supabase's own design. Callers MUST keep a hardcoded fallback in sync with
 * the migration's seeded content and use it only when the registry is
 * genuinely unreachable, mirroring SupabaseSettingsAdapter.getRegistrySettings.
 */
export class SupabasePromptAdapter {
  private static cache = new Map<string, { value: string; expiresAt: number }>();
  private static readonly CACHE_TTL_MS = 60_000;

  /**
   * Resolve a single prompt by its registry key (e.g.
   * 'prompt.executive_digest.system'). Returns `fallback` if the row/secret
   * doesn't exist or the registry is unreachable -- never throws, since a
   * prompt-serving failure must not take down analysis generation.
   */
  static async getPrompt(key: string, fallback: string): Promise<string> {
    const now = Date.now();
    const cached = SupabasePromptAdapter.cache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;

    try {
      const service = getSupabaseServiceClient();
      // Vault's decrypted_secrets is not exposed over PostgREST (by Supabase's
      // own design) -- read through the SECURITY DEFINER RPC the migration
      // creates instead of a direct table/schema query.
      const { data, error } = await service.rpc('get_prompt_secret', { p_key: key });
      if (error) throw error;
      if (!data) return fallback;

      SupabasePromptAdapter.cache.set(key, { value: data, expiresAt: now + SupabasePromptAdapter.CACHE_TTL_MS });
      return data;
    } catch (error) {
      console.warn(`[SupabasePromptAdapter] getPrompt(${key}) failed, using fallback:`, error instanceof Error ? error.message : String(error));
      Sentry.captureException(error, { tags: { method: 'getPrompt' }, extra: { key } });
      return fallback;
    }
  }
}
