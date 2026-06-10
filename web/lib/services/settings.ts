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
  chat: ['google/gemini-2.0-flash', 'anthropic/claude-3.5-haiku'],
  analysis: ['google/gemini-2.0-flash', 'anthropic/claude-3.5-haiku'],
};

interface ModelConfig {
  version?: number;
  plans?: Partial<Record<UserTier, Partial<Record<ModelKind, string[]>>>>;
  testOverride?: { enabled?: boolean } & Partial<Record<ModelKind, string[]>>;
}

const TTL_MS = 60_000;
let cache: { value: ModelConfig | null; at: number } | null = null;

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
    return ['google/gemini-2.0-flash', 'anthropic/claude-3.5-haiku'];
  }

  const cfg = await readModelConfig();

  const override = cfg?.testOverride;
  if (override?.enabled && isNonEmptyStringArray(override[kind])) {
    return override[kind] as string[];
  }

  const planList = cfg?.plans?.[tier]?.[kind];
  if (isNonEmptyStringArray(planList)) return planList;

  return [...FALLBACK[kind]];
}

/** Admin write path / tests: drop the cache so the next read re-fetches. */
export function invalidateSettingsCache(): void {
  cache = null;
}
