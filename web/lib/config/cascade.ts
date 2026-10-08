import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';

/**
 * A single model in a fallback cascade.
 * @property model - OpenRouter model ID (must be in CASCADE_MODEL_ALLOWLIST)
 * @property name - Human-readable display name
 * @property cost - Optional cost per 1K tokens
 * @property providerOrder - Optional list of providers to try in order (e.g., ['groq', 'google-vertex'])
 */
export interface CascadeItem {
  model: string;
  name: string;
  cost?: number;
  providerOrder?: string[];
  /** Per-tier output cap, stamped at resolve time from analysis.maxOutputTokens.* (never stored in the DB — see MODEL_CAPABILITIES). */
  maxOutputTokens?: number;
  /** Per-tier provider-pinning requirement, stamped at resolve time from MODEL_CAPABILITIES. */
  requiresProviderOrder?: boolean;
}

// All cascades below are registry-driven (supabase/migrations/20260725140000_cascade_registry.sql,
// keys 'cascade.chat'/'cascade.analysis'/'cascade.stance'/'cascade.reasoning.free'/
// 'cascade.reasoning.proEnterprise') so they're tunable from the settings page
// without a redeploy, per explicit user directive 2026-07-25 ("this is why I
// said all should be under system settings"). The arrays below are ONLY the
// fallback used if the registry is unreachable -- kept in sync with each
// migration's seeded default_value, never the live source of truth. Web-side
// callers MUST use the resolve*Cascade() functions below, not these constants
// directly; worker-side callers (no DB access per ADR 005) receive the
// resolved cascade forwarded through the signed stream payload instead.

const CHAT_CASCADE_FALLBACK: readonly CascadeItem[] = [
  { model: 'openai/gpt-oss-120b', name: 'gpt-oss-120b (Cerebras)', cost: 0.00035, providerOrder: ['cerebras'] },
  { model: 'openai/gpt-oss-120b', name: 'gpt-oss-120b (Groq)', cost: 0.00015, providerOrder: ['groq'] },
  { model: 'openai/gpt-oss-120b', name: 'gpt-oss-120b (Baseten)', cost: 0.00015, providerOrder: ['baseten'] },
  { model: 'google/gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite (AI Studio)', cost: 0.00025, providerOrder: ['google-ai-studio'] },
  { model: 'google/gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite (Vertex)', cost: 0.00025, providerOrder: ['google-vertex'] },
];

// Dedicated from cascade.chat (2026-08-18, supabase/migrations/20260818000000_cascade_digest.sql)
// per the "each helper function gets its own cascade" standing directive --
// Groq-primary/Cerebras-fallback rather than chat's Cerebras-primary, since
// the digest pass runs in the background and does not need chat's
// speed-first tradeoff (user directive 2026-08-17).
// Provider lock (user directive 2026-09-28): exec-digest gpt-oss-120b is
// Groq (1) -> Cerebras (2) ONLY, no unlisted-provider fallback (allow_fallbacks
// false in the adapter). Baseten/DeepInfra/other routes are unacceptable for
// the digest — they were leaking in via allow_fallbacks:true + this entry.
const DIGEST_CASCADE_FALLBACK: readonly CascadeItem[] = [
  { model: 'openai/gpt-oss-120b', name: 'gpt-oss-120b (Groq)', cost: 0.00015, providerOrder: ['groq'] },
  { model: 'openai/gpt-oss-120b', name: 'gpt-oss-120b (Cerebras)', cost: 0.00035, providerOrder: ['cerebras'] },
];

const ANALYSIS_CASCADE_FALLBACK: readonly CascadeItem[] = [
  // Provider order (2026-08-18, explicit user directive): Vertex/global first,
  // Azure second, Bedrock third -- same model/cost, Bedrock observed slower
  // in practice. Anthropic Direct kept as a fallback ahead of Bedrock.
  { model: 'anthropic/claude-haiku-5.5', name: 'Claude Haiku 5.5 (Vertex)', cost: 0.0015, providerOrder: ['google-vertex'] },
  { model: 'anthropic/claude-haiku-5.5', name: 'Claude Haiku 5.5 (Azure)', cost: 0.0015, providerOrder: ['azure'] },
  { model: 'anthropic/claude-haiku-5.5', name: 'Claude Haiku 5.5 (Anthropic Direct)', cost: 0.0015, providerOrder: ['anthropic'] },
  { model: 'anthropic/claude-haiku-5.5', name: 'Claude Haiku 5.5 (Bedrock)', cost: 0.0015, providerOrder: ['amazon-bedrock'] },
  { model: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5 (Vertex)', cost: 0.003, providerOrder: ['google-vertex'] },
  { model: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5 (Anthropic Direct)', cost: 0.003, providerOrder: ['anthropic'] },
];

// 2026-07-25: given its own values (previously aliased cascade.analysis with
// no real reasoning behind that -- see migration 20260725150000). gpt-oss-120b
// across the same 3 providers as the original chat cascade, then Llama 3.3 70B
// on Groq instead of a heavier/pricier fallback -- deliberately does not
// escalate into Haiku/Sonnet the way analysis does.
const STANCE_CASCADE_FALLBACK: readonly CascadeItem[] = [
  { model: 'openai/gpt-oss-120b', name: 'gpt-oss-120b (Groq)', cost: 0.00015, providerOrder: ['groq'] },
  { model: 'openai/gpt-oss-120b', name: 'gpt-oss-120b (Vertex)', cost: 0.00015, providerOrder: ['google-vertex'] },
  { model: 'openai/gpt-oss-120b', name: 'gpt-oss-120b (Cerebras)', cost: 0.00035, providerOrder: ['cerebras'] },
  { model: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B (Groq)', cost: 0.0000004, providerOrder: ['groq'] },
];

// ADR 026 §4.5: dedicated cascade for chunk-scoped grounded entity extraction,
// separately named/logged from cascade.analysis so OpenRouter's app-source
// logs attribute extraction cost independently from dimension-synthesis cost.
const ENTITY_EXTRACTION_CASCADE_FALLBACK: readonly CascadeItem[] = [
  { model: 'openai/gpt-oss-120b', name: 'gpt-oss-120b (Cerebras)', cost: 0.00035, providerOrder: ['cerebras'] },
  { model: 'openai/gpt-oss-120b', name: 'gpt-oss-120b (Groq)', cost: 0.00015, providerOrder: ['groq'] },
];

const REASONING_CASCADE_FREE_FALLBACK: readonly CascadeItem[] = [
  { model: 'google/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
];

const REASONING_CASCADE_PRO_FALLBACK: readonly CascadeItem[] = [
  { model: 'openai/o3-mini', name: 'o3-mini (OpenAI)' },
  { model: 'google/gemini-3.6-flash', name: 'Gemini 3.6 Flash (AI Studio)', providerOrder: ['google-ai-studio'] },
  { model: 'google/gemini-3.6-flash', name: 'Gemini 3.6 Flash (Vertex)', providerOrder: ['google-vertex'] },
  { model: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5 (Vertex)', providerOrder: ['google-vertex'] },
];

/** Synchronous fallbacks, exported ONLY for worker-side default construction
 * (worker has no DB access -- see ADR 005) when a request arrives from a
 * stale client that didn't forward a resolved cascade. Web-side code must
 * use the resolve*Cascade() functions instead so registry edits take effect
 * without a redeploy. */
export const CASCADE_FALLBACKS = {
  chat: CHAT_CASCADE_FALLBACK,
  digest: DIGEST_CASCADE_FALLBACK,
  analysis: ANALYSIS_CASCADE_FALLBACK,
  stance: STANCE_CASCADE_FALLBACK,
  entityExtraction: ENTITY_EXTRACTION_CASCADE_FALLBACK,
  reasoningFree: REASONING_CASCADE_FREE_FALLBACK,
  reasoningPro: REASONING_CASCADE_PRO_FALLBACK,
} as const;

/** The full dotted registry keys every resolveCascade call site may use (ADR 041: strict keys, never a loose `string`). */
export type CascadeRegistryKey =
  | 'cascade.chat'
  | 'cascade.digest'
  | 'cascade.analysis'
  | 'cascade.stance'
  | 'cascade.entityExtraction'
  | 'cascade.reasoning.free'
  | 'cascade.reasoning.proEnterprise';

/**
 * ADR 041 (2026-10-06): the ONLY model-ID-keyed dispatch knowledge. Lives here
 * in the registry-definition layer so the worker's dispatch code can be fully
 * model-agnostic — capabilities ride the forwarded cascade per tier instead of
 * the worker re-deriving them from inline string comparisons (the old
 * `isHaiku45 = model === '...'` dispatch literals, now removed).
 * Merged into resolved items by model ID at resolve time; deliberately NOT part
 * of the saved registry value (ADR 040's save schema is `.strict()` and would
 * reject unknown fields).
 */
const MODEL_CAPABILITIES: Readonly<Record<string, { tokenCapKey?: 'haiku'; requiresProviderOrder?: boolean }>> = {
  'anthropic/claude-haiku-4.5': { tokenCapKey: 'haiku', requiresProviderOrder: true },
  'anthropic/claude-haiku-5.5': { tokenCapKey: 'haiku', requiresProviderOrder: true },
};

const OUTPUT_TOKEN_REGISTRY_KEYS = ['analysis.maxOutputTokens.haiku', 'analysis.maxOutputTokens.default'] as const;
const OUTPUT_TOKEN_FALLBACKS = { haiku: 8192, default: 16000 } as const;

/** Validates a registry-resolved cascade array, throwing with a labeled SSOT-violation message. */
function assertValidCascadeItems(key: CascadeRegistryKey, items: unknown): asserts items is CascadeItem[] {
  /** Formats a labeled SSOT-violation error message for this key. */
  const label = (msg: string) => `Cascade Registry SSOT Violation (${key}): ${msg}`;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(label('registry-resolved value must be a non-empty array of cascade tiers'));
  }
  for (const item of items) {
    if (!item || typeof item !== 'object') throw new Error(label('each tier must be an object'));
    const { model, name } = item as Partial<CascadeItem>;
    if (typeof model !== 'string' || model.trim().length === 0) throw new Error(label('tier has an empty or missing model ID'));
    if (typeof name !== 'string' || name.trim().length === 0) throw new Error(label(`tier '${model}' has an empty or missing display name`));
  }
}

/**
 * ADR 040 (2026-10-05): every model ID the code-side registry actually uses.
 * The settings save path (validateAgainstContract's cascadeRegistry marker)
 * rejects any cascade.* value referencing a model outside this list, so a
 * typo'd/deprecated ID (e.g. claude-3-5-haiku, zero code references) fails
 * at SAVE time instead of shipping silently as runtime OpenRouter 404s.
 * Derived from CASCADE_FALLBACKS so the two cannot drift; adding a model to
 * a fallback automatically extends the allowlist. Updated via the same PR
 * flow as code changes — deliberately NOT stored in the DB.
 */
export const CASCADE_MODEL_ALLOWLIST: readonly string[] = Array.from(
  new Set(
    Object.values(CASCADE_FALLBACKS).flatMap((cascade) => cascade.map((item) => item.model)),
  ),
).sort();

/**
 * Resolves a cascade.* registry key and stamps per-tier dispatch capabilities
 * onto the items (ADR 041). Fail-fast contract:
 * - Registry unreachable (DB error) → resilient fallback (adapter-logged, not
 *   cached) — unchanged behavior, an infra outage must not take down analyses.
 * - Registry REACHABLE but value malformed (non-array / empty / blank model or
 *   name) → explicit `Cascade Registry SSOT Violation` throw instead of the
 *   previous silent fallback, per the 10X registry-enforcement mission. ADR
 *   040's save-time validation should prevent this from ever being saved.
 */
function parseValidTokenCap(key: string, val: unknown, fallback: number): number {
  if (val === undefined || val === null) return fallback;
  const num = Number(val);
  if (!Number.isFinite(num) || num <= 0 || !Number.isInteger(num)) {
    throw new Error(`Cascade Registry SSOT Violation: setting '${key}' must be a positive integer, received: ${String(val)}`);
  }
  return num;
}

async function resolveCascade(key: CascadeRegistryKey, fallback: readonly CascadeItem[]): Promise<CascadeItem[]> {
  const resolved = await SupabaseSettingsAdapter.getRegistrySettings(
    [key, ...OUTPUT_TOKEN_REGISTRY_KEYS],
    { [key]: fallback as CascadeItem[], 'analysis.maxOutputTokens.haiku': OUTPUT_TOKEN_FALLBACKS.haiku, 'analysis.maxOutputTokens.default': OUTPUT_TOKEN_FALLBACKS.default } as Record<string, unknown>
  );
  const tokenCaps = {
    haiku: parseValidTokenCap('analysis.maxOutputTokens.haiku', resolved['analysis.maxOutputTokens.haiku'], OUTPUT_TOKEN_FALLBACKS.haiku),
    default: parseValidTokenCap('analysis.maxOutputTokens.default', resolved['analysis.maxOutputTokens.default'], OUTPUT_TOKEN_FALLBACKS.default),
  };

  const value = resolved[key];
  if (value !== (fallback as readonly CascadeItem[])) {
    // Registry actually supplied a value — validate it structurally, fail fast on garbage.
    assertValidCascadeItems(key, value);
  }
  const items = (Array.isArray(value) && value.length > 0 ? value : fallback) as readonly CascadeItem[];

  // Stamp per-tier dispatch capabilities by model ID (never persisted in the
  // registry value itself — see MODEL_CAPABILITIES). Stamp ONLY bound models:
  // unbound tiers stay unstamped so the worker's forwarded
  // analysis.maxOutputTokens.default fallback remains the live source for them.
  return items.map((item) => {
    const caps = MODEL_CAPABILITIES[item.model];
    if (!caps) return { ...item };
    if (caps.requiresProviderOrder && (!Array.isArray(item.providerOrder) || item.providerOrder.length === 0)) {
      throw new Error(`Cascade Registry SSOT Violation (${key}): model '${item.model}' requires a non-empty providerOrder`);
    }
    return {
      ...item,
      ...(caps.tokenCapKey ? { maxOutputTokens: tokenCaps[caps.tokenCapKey] } : {}),
      ...(caps.requiresProviderOrder ? { requiresProviderOrder: true } : {}),
    };
  });
}

export const DIARIZATION_PROVIDER_ALLOWLIST = ['assemblyai', 'deepgram'] as const;
export type DiarizationProviderName = (typeof DIARIZATION_PROVIDER_ALLOWLIST)[number];

export interface DiarizationCascadeItem {
  provider: DiarizationProviderName;
  name: string;
  timeoutMs?: number;
}

const DIARIZATION_CASCADE_FALLBACK: readonly DiarizationCascadeItem[] = [
  { provider: 'assemblyai', name: 'AssemblyAI Universal-1', timeoutMs: 15000 },
  { provider: 'deepgram', name: 'Deepgram Nova-2', timeoutMs: 10000 },
];

/**
 * Resolves the diarization provider cascade from the Settings Registry
 * (`cascade.diarization`), falling back to the hardcoded defaults when the
 * key is unset or empty. Accepts both string-provider entries and full
 * {@link DiarizationCascadeItem} objects; unallowlisted providers are dropped.
 */
export const resolveDiarizationCascade = async (): Promise<DiarizationCascadeItem[]> => {
  const resolved = await SupabaseSettingsAdapter.getRegistrySettings(
    ['cascade.diarization'],
    { 'cascade.diarization': DIARIZATION_CASCADE_FALLBACK as DiarizationCascadeItem[] }
  );
  const value = resolved['cascade.diarization'];
  if (!Array.isArray(value) || value.length === 0) {
    return [...DIARIZATION_CASCADE_FALLBACK];
  }

  const normalized: DiarizationCascadeItem[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      if (DIARIZATION_PROVIDER_ALLOWLIST.includes(item as DiarizationProviderName)) {
        normalized.push({
          provider: item as DiarizationProviderName,
          name: item === 'assemblyai' ? 'AssemblyAI Universal-1' : 'Deepgram Nova-2',
        });
      }
    } else if (item && typeof item === 'object' && typeof item.provider === 'string') {
      if (DIARIZATION_PROVIDER_ALLOWLIST.includes(item.provider as DiarizationProviderName)) {
        normalized.push({
          provider: item.provider as DiarizationProviderName,
          name: typeof item.name === 'string' && item.name ? item.name : item.provider,
          ...(typeof item.timeoutMs === 'number' && item.timeoutMs > 0 ? { timeoutMs: item.timeoutMs } : {}),
        });
      }
    }
  }

  return normalized.length > 0 ? normalized : [...DIARIZATION_CASCADE_FALLBACK];
};

export const resolveChatCascade = (): Promise<CascadeItem[]> => resolveCascade('cascade.chat', CHAT_CASCADE_FALLBACK);
export const resolveDigestCascade = (): Promise<CascadeItem[]> => resolveCascade('cascade.digest', DIGEST_CASCADE_FALLBACK);
export const resolveAnalysisCascade = (): Promise<CascadeItem[]> => resolveCascade('cascade.analysis', ANALYSIS_CASCADE_FALLBACK);
export const resolveStanceCascade = (): Promise<CascadeItem[]> => resolveCascade('cascade.stance', STANCE_CASCADE_FALLBACK);
export const resolveEntityExtractionCascade = (): Promise<CascadeItem[]> => resolveCascade('cascade.entityExtraction', ENTITY_EXTRACTION_CASCADE_FALLBACK);
export const resolveReasoningCascade = (tier: 'free' | 'pro' | 'enterprise'): Promise<CascadeItem[]> =>
  tier === 'free'
    ? resolveCascade('cascade.reasoning.free', REASONING_CASCADE_FREE_FALLBACK)
    : resolveCascade('cascade.reasoning.proEnterprise', REASONING_CASCADE_PRO_FALLBACK);
