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

/**
 * LLM cascade for chat operations.
 * Prioritizes fast, cheap models for conversational AI:
 * - Groq GPT-OSS-120B (fastest free option)
 * - Google Vertex (fallback)
 * - Cerebras (third fallback)
 * - Gemini 3.1 Flash Lite
 * - Gemini 2.0 Flash (safety net)
 */
export const CHAT_CASCADE: readonly CascadeItem[] = [
  {
    model: 'openai/gpt-oss-120b',
    name: 'gpt-oss-120b (Groq)',
    cost: 0.00015,
    providerOrder: ['groq'],
  },
  {
    model: 'openai/gpt-oss-120b',
    name: 'gpt-oss-120b (Vertex Global)',
    cost: 0.00015,
    providerOrder: ['google-vertex'],
  },
  {
    model: 'openai/gpt-oss-120b',
    name: 'gpt-oss-120b (Cerebras)',
    cost: 0.00035,
    providerOrder: ['cerebras'],
  },
  {
    model: 'google/gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    cost: 0.00025,
    providerOrder: ['google-vertex'],
  },
  {
    model: 'google/gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    cost: 0.00015,
  },
] as const;

/**
 * LLM cascade for video analysis operations.
 * Uses Claude models with high output limits for comprehensive analysis:
 * - Claude Haiku 4.5 (primary, cost-effective)
 * - Claude Haiku 4.5 via alternate providers (Vertex/Bedrock as failover)
 * - Claude Sonnet 4.6 Nitro (premium fallback)
 */
export const ANALYSIS_CASCADE: readonly CascadeItem[] = [
  {
    model: 'anthropic/claude-haiku-4.5',
    name: 'Claude Haiku 4.5',
    cost: 0.0015,
  },
  {
    model: 'anthropic/claude-haiku-4.5',
    name: 'Claude Haiku 4.5 (Alternate Route)',
    cost: 0.0015,
    providerOrder: ['google-vertex', 'amazon-bedrock'],
  },
  {
    model: 'anthropic/claude-sonnet-4.6:nitro',
    name: 'Claude Sonnet 4.6 (Nitro)',
    cost: 0.003,
  },
] as const;

/**
 * LLM cascade for stance/perspective analysis.
 * Aliases to ANALYSIS_CASCADE since the same model requirements apply.
 */
export const STANCE_CASCADE: readonly CascadeItem[] = ANALYSIS_CASCADE;

/**
 * Premium reasoning model cascade for deep analysis.
 * Used when user tier allows reasoning-enhanced synthesis.
 * - o3-mini (OpenAI, training-exempt)
 * - Gemini 1.5 Pro (multimodal capable)
 * - Claude 3.5 Sonnet (fallback)
 */
const PRO_REASONING_CASCADE: readonly CascadeItem[] = [
  {
    model: 'openai/o3-mini',
    name: 'o3-mini (OpenAI)',
  },
  {
    model: 'google/gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
  },
  {
    model: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
  },
];

/**
 * Tier-based reasoning model cascades.
 * Determines available reasoning models based on user subscription tier:
 * - free: Gemini 2.0 Flash (basic reasoning)
 * - pro: Full PRO_REASONING_CASCADE
 * - enterprise: Full PRO_REASONING_CASCADE
 */
export const REASONING_CASCADE: Record<string, readonly CascadeItem[]> = {
  free: [
    {
      model: 'google/gemini-2.0-flash',
      name: 'Gemini 2.0 Flash',
    },
  ],
  pro: PRO_REASONING_CASCADE,
  enterprise: PRO_REASONING_CASCADE,
};
