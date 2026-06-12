/**
 * Settings service — server-only read of `public.app_settings` (DB-backed config).
 *
 * The `model_config` row holds per-tier LLM cascades for chat + analysis. The DB is
 * the OVERRIDE source of truth; the hardcoded arrays below are the safety-net fallback,
 * used verbatim whenever the row is missing, malformed, or the DB read fails. Part B
 * must never harden the live LLM path into a hard DB dependency — a settings outage
 * degrades to the current hardcoded behaviour, it does not break analysis.
 *
 * A short module-level TTL cache avoids a Supabase round-trip on every request.
 *
 * @see supabase/migrations/20260605120000_add_app_settings.sql (seed + schema)
 */
import { getSupabaseServiceClient } from '@/lib/supabase';
import type { UserTier } from '@/lib/types/billing';
import { CHAT_CASCADE, ANALYSIS_CASCADE, REASONING_CASCADE } from '../config/cascade';
import { UCIS_V5_1_SYSTEM } from '../prompts/ucis-v5.1';
import { getRedisValue, setRedisValue, deleteRedisKey } from '../redis';

export type ModelKind = 'chat' | 'analysis';

/**
 * Safety-net defaults. MIRROR of:
 *   chat     -> web/lib/config/prompts.ts            (CHAT_MODELS)
 *   analysis -> worker/src/services/LLMCascade.ts    (MODEL_CHAIN)
 * Kept local so a DB outage never strands the pipeline.
 */

/** Commercial trial mode — hard override. */
const COMMERCIAL_TRIAL_MODE = true;

const FALLBACK: Record<ModelKind, readonly string[]> = {
  chat: CHAT_CASCADE.map((c) => c.model),
  analysis: ANALYSIS_CASCADE.map((c) => c.model),
};

interface ModelConfig {
  version?: number;
  plans?: Partial<Record<UserTier, Partial<Record<ModelKind, string[]>>>>;
  testOverride?: { enabled?: boolean } & Partial<Record<ModelKind, string[]>>;
}

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
let cache: { value: ModelConfig | null; at: number } | null = null;
let promptCache: { value: PromptConfig | null; at: number } | null = null;

function isNonEmptyStringArray(v: unknown): v is string[] {
  // Reject empty/whitespace entries: a malformed DB config (e.g. ["", "x"]) must fall
  // through to the next precedence tier, never emit a blank model id to OpenRouter.
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x.trim().length > 0);
}

async function readModelConfig(): Promise<ModelConfig | null> {
  // Tier 1: Local In-Memory Cache (TTL: 60s)
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    // Tier 2: Upstash Redis
    const redisKey = 'config:model_config';
    const redisVal = await getRedisValue(redisKey);
    if (redisVal) {
      const parsed = typeof redisVal === 'string' ? JSON.parse(redisVal) : redisVal;
      cache = { value: parsed, at: Date.now() };
      return parsed;
    }

    // Tier 3: Supabase DB
    const service = getSupabaseServiceClient();
    const { data, error } = await service
      .from('app_settings')
      .select('value')
      .eq('key', 'model_config')
      .single();
    const value = error || !data ? null : (data.value as ModelConfig);

    if (value) {
      // Warm up Redis with a 24-hour TTL (86400s)
      await setRedisValue(redisKey, value, 86400);
    }

    cache = { value, at: Date.now() };
    return value;
  } catch {
    // DB/Redis unreachable — fall back to local cache, don't throw on the live path.
    cache = { value: null, at: Date.now() };
    return null;
  }
}

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

    // Tier 3: Supabase DB
    const service = getSupabaseServiceClient();
    const { data, error } = await service
      .from('app_settings')
      .select('value')
      .eq('key', 'prompt_config')
      .single();
    const value = error || !data ? null : (data.value as PromptConfig);

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

/**
 * Resolve the ordered model cascade for a (tier, kind). Precedence:
 *   1. COMMERCIAL_TRIAL_MODE — if active, return Haiku-only immediately (hard override).
 *   2. testOverride (when enabled) — the global "switch Haiku on for now" toggle.
 *   3. plans[tier][kind] — the per-plan cascade.
 *   4. hardcoded FALLBACK — safety net.
 * Always returns a non-empty list.
 */
export async function resolveModelCascade(tier: UserTier, kind: ModelKind): Promise<string[]> {
  if (COMMERCIAL_TRIAL_MODE) {
    if (kind === 'chat') {
      return CHAT_CASCADE.map((c) => c.model);
    }
    return ANALYSIS_CASCADE.map((c) => c.model);
  }

  const cfg = await readModelConfig();

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

  // Defensive engineering: map invalid/stale model IDs to working ones
  return resolved.map((m) =>
    m === 'anthropic/claude-4.5-haiku' ? 'anthropic/claude-haiku-4.5' : m
  );
}

export async function resolveReasoningCascade(tier: UserTier): Promise<string[]> {
  const cascade = REASONING_CASCADE[tier] || REASONING_CASCADE.free || [];
  return cascade.map((item) => item.model);
}

/** Admin write path / tests: drop the cache so the next read re-fetches. */
export function invalidateSettingsCache(): void {
  cache = null;
  promptCache = null;
  // Clear from Redis so all edge regions reload fresh configs
  deleteRedisKey('config:model_config').catch(() => null);
  deleteRedisKey('config:prompt_config').catch(() => null);
}

