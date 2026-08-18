import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';

/**
 * A single model in a fallback cascade.
 * @property model - OpenRouter model ID (e.g., 'anthropic/claude-haiku-4.5')
 * @property name - Human-readable display name
 * @property cost - Optional cost per 1K tokens
 * @property providerOrder - Optional list of providers to try in order (e.g., ['groq', 'google-vertex'])
 */
export interface CascadeItem {
  model: string;
  name: string;
  cost?: number;
  providerOrder?: string[];
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
const DIGEST_CASCADE_FALLBACK: readonly CascadeItem[] = [
  { model: 'openai/gpt-oss-120b', name: 'gpt-oss-120b (Groq)', cost: 0.00015, providerOrder: ['groq'] },
  { model: 'openai/gpt-oss-120b', name: 'gpt-oss-120b (Cerebras)', cost: 0.00035, providerOrder: ['cerebras'] },
  { model: 'openai/gpt-oss-120b', name: 'gpt-oss-120b (Baseten)', cost: 0.00015, providerOrder: ['baseten'] },
];

const ANALYSIS_CASCADE_FALLBACK: readonly CascadeItem[] = [
  // Provider order (2026-08-18, explicit user directive): Vertex/global first,
  // Azure second, Bedrock third -- same model/cost, Bedrock observed slower
  // in practice. Anthropic Direct kept as a fallback ahead of Bedrock.
  { model: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5 (Vertex)', cost: 0.0015, providerOrder: ['google-vertex'] },
  { model: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5 (Azure)', cost: 0.0015, providerOrder: ['azure'] },
  { model: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5 (Anthropic Direct)', cost: 0.0015, providerOrder: ['anthropic'] },
  { model: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5 (Bedrock)', cost: 0.0015, providerOrder: ['amazon-bedrock'] },
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

async function resolveCascade(key: string, fallback: readonly CascadeItem[]): Promise<CascadeItem[]> {
  const resolved = await SupabaseSettingsAdapter.getRegistrySettings(
    [key],
    { [key]: fallback as CascadeItem[] }
  );
  const value = resolved[key];
  return Array.isArray(value) && value.length > 0 ? (value as CascadeItem[]) : [...fallback];
}

export const resolveChatCascade = (): Promise<CascadeItem[]> => resolveCascade('cascade.chat', CHAT_CASCADE_FALLBACK);
export const resolveDigestCascade = (): Promise<CascadeItem[]> => resolveCascade('cascade.digest', DIGEST_CASCADE_FALLBACK);
export const resolveAnalysisCascade = (): Promise<CascadeItem[]> => resolveCascade('cascade.analysis', ANALYSIS_CASCADE_FALLBACK);
export const resolveStanceCascade = (): Promise<CascadeItem[]> => resolveCascade('cascade.stance', STANCE_CASCADE_FALLBACK);
export const resolveEntityExtractionCascade = (): Promise<CascadeItem[]> => resolveCascade('cascade.entityExtraction', ENTITY_EXTRACTION_CASCADE_FALLBACK);
export const resolveReasoningCascade = (tier: 'free' | 'pro' | 'enterprise'): Promise<CascadeItem[]> =>
  tier === 'free'
    ? resolveCascade('cascade.reasoning.free', REASONING_CASCADE_FREE_FALLBACK)
    : resolveCascade('cascade.reasoning.proEnterprise', REASONING_CASCADE_PRO_FALLBACK);
