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
    providerOrder: ['google-vertex/global'],
  },
  {
    model: 'openai/gpt-oss-120b',
    name: 'gpt-oss-120b (Cerebras)',
    cost: 0.00035,
    providerOrder: ['cerebras/fp16'],
  },
  {
    model: 'google/gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    cost: 0.00025,
    providerOrder: ['google-vertex/global'],
  },
  {
    model: 'google/gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    cost: 0.00015,
  },
] as const;

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
    providerOrder: ['google-vertex/global', 'google-vertex/europe', 'amazon-bedrock/global'],
  },
  {
    model: 'anthropic/claude-sonnet-4.6:nitro',
    name: 'Claude Sonnet 4.6 (Nitro)',
    cost: 0.003,
  },
] as const;

export const STANCE_CASCADE: readonly CascadeItem[] = ANALYSIS_CASCADE;

export const REASONING_CASCADE: Record<string, readonly CascadeItem[]> = {
  free: [
    {
      model: 'google/gemini-2.0-flash-thinking-exp:free',
      name: 'Gemini 2.0 Flash Thinking (Free)',
    },
    {
      model: 'deepseek/deepseek-r1:free',
      name: 'DeepSeek R1 (Free)',
    },
  ],
  pro: [
    {
      model: 'deepseek/deepseek-r1',
      name: 'DeepSeek R1 (Paid)',
    },
    {
      model: 'google/gemini-2.0-flash-thinking-exp:free',
      name: 'Gemini 2.0 Flash Thinking (Free)',
    },
    {
      model: 'anthropic/claude-3.5-sonnet',
      name: 'Claude 3.5 Sonnet',
    },
  ],
  enterprise: [
    {
      model: 'deepseek/deepseek-r1',
      name: 'DeepSeek R1 (Paid)',
    },
    {
      model: 'google/gemini-2.0-flash-thinking-exp:free',
      name: 'Gemini 2.0 Flash Thinking (Free)',
    },
    {
      model: 'anthropic/claude-3.5-sonnet',
      name: 'Claude 3.5 Sonnet',
    },
  ],
};

