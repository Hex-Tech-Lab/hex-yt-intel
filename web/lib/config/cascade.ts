export interface CascadeItem {
  model: string;
  name: string;
  cost?: number;
  providerOrder?: string[];
}

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

export const ANALYSIS_CASCADE: readonly CascadeItem[] = [
  {
    model: 'anthropic/claude-3.5-haiku',
    name: 'Claude 3.5 Haiku',
    cost: 0.0015,
  },
  {
    model: 'anthropic/claude-3.5-haiku',
    name: 'Claude 3.5 Haiku (Alternate Route)',
    cost: 0.0015,
    providerOrder: ['google-vertex', 'amazon-bedrock'],
  },
  {
    model: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    cost: 0.003,
  },
] as const;

export const STANCE_CASCADE: readonly CascadeItem[] = ANALYSIS_CASCADE;

export const REASONING_CASCADE: Record<string, readonly CascadeItem[]> = {
  free: [
    {
      model: 'google/gemini-2.0-flash',
      name: 'Gemini 2.0 Flash',
    },
  ],
  pro: [
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
  ],
  enterprise: [
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
  ],
};

