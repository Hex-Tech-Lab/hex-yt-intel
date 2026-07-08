/**
 * Settings service — server-only read of `public.app_settings` (DB-backed config).
 *
 * A short module-level TTL cache avoids a Supabase round-trip on every request.
 */
import { SupabasePersistenceAdapter } from '@lib/adapters/SupabasePersistenceAdapter';
import { UCIS_V5_1_SYSTEM } from '@lib/prompts/ucis-v5.1';
import { getRedisValue, setRedisValue, deleteRedisKey } from '@lib/redis';

export interface PromptHistoryEntry {
  version: string;
  timestamp: string;
  author: string;
  description?: string;
}

export interface PromptConfig {
  latest?: string;
  history?: PromptHistoryEntry[];
  versions?: Record<string, string>;
  [key: string]: any;
}

const TTL_MS = 60_000;
let promptCache: { value: PromptConfig | null; at: number } | null = null;

async function readPromptConfig(): Promise<PromptConfig | null> {
  // Tier 1: Local In-Memory Cache (TTL: 60s)
  if (promptCache && Date.now() - promptCache.at < TTL_MS) return promptCache.value;
  try {
    // Tier 2: Upstash Redis
    const redisKey = 'config:prompt_config';
    const redisVal = await getRedisValue(redisKey);
    if (redisVal) {
      const parsed = typeof redisVal === 'string' ? JSON.parse(redisVal) : redisVal;
      promptCache = { value: parsed, at: Date.now() };
      return parsed;
    }

    // Tier 3: Supabase DB via Persistence Port
    const persistence = new SupabasePersistenceAdapter();
    const dbVal = await persistence.getAppSetting('prompt_config');
    const value = dbVal as PromptConfig | null;

    if (value) {
      // Warm up Redis with a 24-hour TTL (86400s)
      await setRedisValue(redisKey, value, 86400);
    }

    promptCache = { value, at: Date.now() };
    return value;
  } catch {
    // DB/Redis unreachable — fall back to local cache, don't throw on the live path.
    promptCache = { value: null, at: Date.now() };
    return null;
  }
}

function getHighestVersion(versions: string[]): string | undefined {
  if (versions.length === 0) return undefined;
  return [...versions].sort((a, b) => {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aVal = aParts[i] ?? 0;
      const bVal = bParts[i] ?? 0;
      if (aVal !== bVal) return bVal - aVal; // Descending sort
    }
    return 0;
  })[0];
}

/**
 * Resolve the system prompt template for a version. Precedence:
 *   1. prompt_config row in DB or Redis cache.
 *   2. Static fallback from code.
 */
export async function resolveUCISPromptTemplate(version?: string): Promise<string> {
  const cfg = await readPromptConfig();
  if (!cfg) {
    return UCIS_V5_1_SYSTEM;
  }

  let targetVersion = version;
  if (!targetVersion) {
    // Determine the latest version: use designated latest pointer or sort version keys
    const keys = Object.keys(cfg.versions || {});
    if (keys.length > 0) {
      targetVersion = cfg.latest || getHighestVersion(keys);
    } else {
      // Fallback: get highest key in the legacy flat object (excluding latest/history/versions properties)
      const legacyKeys = Object.keys(cfg).filter((k) => k !== 'latest' && k !== 'history' && k !== 'versions');
      targetVersion = cfg.latest || getHighestVersion(legacyKeys);
    }
  }

  if (targetVersion) {
    const dbPrompt = cfg.versions?.[targetVersion] || cfg[targetVersion];
    if (typeof dbPrompt === 'string' && dbPrompt.trim().length > 0) {
      return dbPrompt;
    }
  }

  // Fallback to static code
  return UCIS_V5_1_SYSTEM;
}

/** Admin write path / tests: drop the cache so the next read re-fetches. */
export function invalidateSettingsCache(): void {
  promptCache = null;
  // Clear from Redis so all edge regions reload fresh configs
  deleteRedisKey('config:model_config').catch(() => null);
  deleteRedisKey('config:prompt_config').catch(() => null);
}
