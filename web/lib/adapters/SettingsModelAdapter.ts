import * as Sentry from '@sentry/nextjs';
import type { UserTier } from '@/lib/types/billing';
import type { ModelResolutionPort } from '@/lib/ports';
import { CHAT_CASCADE, ANALYSIS_CASCADE, REASONING_CASCADE } from '@/lib/config/cascade';
import { getRedisValue, setRedisValue } from '@/lib/redis';
import { SupabasePersistenceAdapter } from './SupabasePersistenceAdapter';

type ModelKind = 'chat' | 'analysis';

interface ModelConfig {
  version?: number;
  plans?: Partial<Record<UserTier, Partial<Record<ModelKind, string[]>>>>;
  testOverride?: { enabled?: boolean } & Partial<Record<ModelKind, string[]>>;
}

const FALLBACK: Record<ModelKind, readonly string[]> = {
  chat: CHAT_CASCADE.map((c) => c.model),
  analysis: ANALYSIS_CASCADE.map((c) => c.model),
};

const TTL_MS = 60_000;
let configCache: { value: ModelConfig | null; at: number } | null = null;

function isNonEmptyStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x.trim().length > 0);
}

async function readModelConfig(persistence: SupabasePersistenceAdapter): Promise<ModelConfig | null> {
  if (configCache && Date.now() - configCache.at < TTL_MS) return configCache.value;
   try {
     const redisKey = 'config:model_config';
     const redisVal = await getRedisValue(redisKey);
     if (redisVal) {
       // Try to parse Redis value
       let parsed: ModelConfig | null = null;
       try {
         parsed = typeof redisVal === 'string' ? JSON.parse(redisVal) : redisVal;
       } catch (parseError) {
         // JSON parse failure - capture and continue to DB fallback
         Sentry.captureException(parseError, { contexts: { settings: { method: 'parseRedisConfig' } } });
       }
       if (parsed) {
         configCache = { value: parsed, at: Date.now() };
         return parsed;
       }
     }

     const dbVal = await persistence.getAppSetting('model_config');
     const value = dbVal as ModelConfig | null;

     if (value) {
       await setRedisValue(redisKey, value, 86400);
     }

     configCache = { value, at: Date.now() };
     return value;
   } catch (error) {
     Sentry.captureException(error, { contexts: { settings: { method: 'getAppSettingCache' } } });
     configCache = { value: null, at: Date.now() };
     return null;
   }
}

/**
 * Resolve LLM models from settings with tier-based and test override support.
 * Reads model configuration from Supabase or returns fallback cascades.
 * Supports commercial trial mode to enable all models for testing.
 */
export class SettingsModelAdapter implements ModelResolutionPort {
  private readonly commercialTrialMode: boolean;
  private persistence = new SupabasePersistenceAdapter();

  constructor(config?: { commercialTrialMode?: boolean }) {
    const envFlag = process.env.COMMERCIAL_TRIAL_MODE;
    this.commercialTrialMode = config?.commercialTrialMode ?? (envFlag !== undefined ? envFlag === 'true' : true);
  }

  /**
   * Get available models for a given user tier and kind (analysis/chat/reasoning).
   * Applies commercial trial mode, Supabase overrides, and tier-specific settings.
   * @param tier User subscription tier
   * @param kind Model kind (analysis, chat, or reasoning)
   * @returns Array of available model IDs
   */
  async resolveModels(tier: UserTier, kind: 'analysis' | 'chat' | 'reasoning'): Promise<string[]> {
    if (kind === 'reasoning') {
      const cascade = REASONING_CASCADE[tier] || REASONING_CASCADE.free || [];
      return cascade.map((item) => item.model);
    }

    if (this.commercialTrialMode) {
      if (kind === 'chat') {
        return CHAT_CASCADE.map((c) => c.model);
      }
      return ANALYSIS_CASCADE.map((c) => c.model);
    }

    const cfg = await readModelConfig(this.persistence);

    let resolved: string[] = [];
    const override = cfg?.testOverride;
    if (override?.enabled && isNonEmptyStringArray(override[kind])) {
      resolved = override[kind] as string[];
    } else {
      const planList = cfg?.plans?.[tier]?.[kind];
      if (isNonEmptyStringArray(planList)) {
        resolved = planList;
      } else {
        resolved = [...FALLBACK[kind]];
      }
    }

    // Defensive mapping
    return resolved.map((m) =>
      m === 'anthropic/claude-4.5-haiku' ? 'anthropic/claude-haiku-4.5' : m
    );
  }
}

/**
 * Clear the cached model configuration to force refresh on next resolution.
 * Useful after Supabase settings are updated.
 */
export function invalidateSettingsModelCache(): void {
  configCache = null;
  void setRedisValue('config:model_config', null as unknown as string, 0);
}