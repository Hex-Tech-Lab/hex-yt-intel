import { getSupabaseServiceClient } from '@/lib/supabase';
import { getRedisValue, setRedisValue, deleteRedisKey } from '@/lib/redis';
import * as Sentry from '@sentry/nextjs';

/**
 * Resolves LLM system prompts from the Vault-backed prompt registry (Wave D3,
 * migration 20260723200000) instead of a hardcoded TS string constant. Prompt
 * text is stored encrypted at rest via supabase_vault (pgsodium) -- read back
 * only through vault.decrypted_secrets, which is service-role-only by
 * Supabase's own design. Callers MUST keep a hardcoded fallback in sync with
 * the migration's seeded content and use it only when the registry is
 * genuinely unreachable, mirroring SupabaseSettingsAdapter.getRegistrySettings.
 *
 * Three-tier cache, matching the established pattern already used for the
 * UCIS v5.3 prompt (web/lib/services/settings.ts resolveUCISPromptTemplate --
 * discovered mid-implementation of this adapter, NOT duplicated logic):
 * in-process (60s) -> Upstash Redis (24h, cross-instance) -> Vault RPC. Once
 * decrypted, the plaintext is cached the same as the settings.ts pattern
 * does for its DB-backed prompt -- Redis and process memory are both
 * server-only trust boundaries already relied on elsewhere in this codebase.
 */
export class SupabasePromptAdapter {
  private static cache = new Map<string, { value: string; expiresAt: number }>();
  private static readonly CACHE_TTL_MS = 60_000;
  private static readonly REDIS_TTL_S = 86_400;

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

    const redisKey = `prompt:${key}`;
    try {
      const redisVal = await getRedisValue(redisKey);
      if (typeof redisVal === 'string' && redisVal.trim().length > 0) {
        SupabasePromptAdapter.cache.set(key, { value: redisVal, expiresAt: now + SupabasePromptAdapter.CACHE_TTL_MS });
        return redisVal;
      }
    } catch (error) {
      console.warn(`[SupabasePromptAdapter] Redis GET failed for ${key}, falling through to DB:`, error instanceof Error ? error.message : String(error));
    }

    try {
      const service = getSupabaseServiceClient();
      // Vault's decrypted_secrets is not exposed over PostgREST (by Supabase's
      // own design) -- read through the SECURITY DEFINER RPC the migration
      // creates instead of a direct table/schema query.
      const { data, error } = await service.rpc('get_prompt_secret', { p_key: key });
      if (error) throw error;
      if (!data) return fallback;

      SupabasePromptAdapter.cache.set(key, { value: data, expiresAt: now + SupabasePromptAdapter.CACHE_TTL_MS });
      setRedisValue(redisKey, data, SupabasePromptAdapter.REDIS_TTL_S).catch((err) => {
        console.warn(`[SupabasePromptAdapter] Redis SET failed for ${key}:`, err instanceof Error ? err.message : String(err));
      });
      return data;
    } catch (error) {
      console.warn(`[SupabasePromptAdapter] getPrompt(${key}) failed, using fallback:`, error instanceof Error ? error.message : String(error));
      Sentry.captureException(error, { tags: { method: 'getPrompt' }, extra: { key } });
      return fallback;
    }
  }

  /** Admin write path: drop both cache tiers so the next read re-fetches from Vault. */
  static async invalidate(key: string): Promise<void> {
    SupabasePromptAdapter.cache.delete(key);
    await deleteRedisKey(`prompt:${key}`).catch(() => null);
  }
}
