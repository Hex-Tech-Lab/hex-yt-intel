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
import { CHAT_CASCADE, ANALYSIS_CASCADE } from '../config/cascade';
import { UCIS_V5_SYSTEM } from '../prompts/ucis-v5';
import { UCIS_V5_1_SYSTEM } from '../prompts/ucis-v5.1';

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

export interface PromptConfig {
  '5.0'?: string;
  '5.1'?: string;
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
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const service = getSupabaseServiceClient();
    const { data, error } = await service
      .from('app_settings')
      .select('value')
      .eq('key', 'model_config')
      .single();
    const value = error || !data ? null : (data.value as ModelConfig);
    cache = { value, at: Date.now() };
    return value;
  } catch {
    // DB unreachable / not migrated yet — fall back, don't throw on the live path.
    cache = { value: null, at: Date.now() };
    return null;
  }
}

async function readPromptConfig(): Promise<PromptConfig | null> {
  if (promptCache && Date.now() - promptCache.at < TTL_MS) return promptCache.value;
  try {
    const service = getSupabaseServiceClient();
    const { data, error } = await service
      .from('app_settings')
      .select('value')
      .eq('key', 'prompt_config')
      .single();
    const value = error || !data ? null : (data.value as PromptConfig);
    promptCache = { value, at: Date.now() };
    return value;
  } catch {
    // DB unreachable / not migrated yet — fall back, don't throw on the live path.
    promptCache = { value: null, at: Date.now() };
    return null;
  }
}

/**
 * Resolve the system prompt template for a version. Precedence:
 *   1. prompt_config row in DB (if key exists and has non-empty prompt for the version).
 *   2. Static fallback from code.
 */
export async function resolveUCISPromptTemplate(version: '5.0' | '5.1'): Promise<string> {
  const cfg = await readPromptConfig();
  const dbPrompt = cfg?.[version];
  if (dbPrompt && dbPrompt.trim().length > 0) {
    return dbPrompt;
  }
  // Fallback to static code
  return version === '5.1' ? UCIS_V5_1_SYSTEM : UCIS_V5_SYSTEM;
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

/** Admin write path / tests: drop the cache so the next read re-fetches. */
export function invalidateSettingsCache(): void {
  cache = null;
  promptCache = null;
}

