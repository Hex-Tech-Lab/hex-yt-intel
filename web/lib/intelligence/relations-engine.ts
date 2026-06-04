/**
 * Stance relations engine — the LLM half of the knowledge-graph intelligence.
 *
 * Related/Similar stay lexical (cheap, deterministic, TF-IDF in knowledge-graph.ts).
 * Tangent/Contrarian are judged here by a fast, non-reasoning model: which dimensions
 * open an adjacent-but-unresolved thread (tangent) vs sit in tension with the video's
 * core thesis (contrarian). Computed post-analysis and cached — never on the hot path.
 *
 * Today the candidate set is the analysis's own dimensions (intra-analysis). When a
 * corpus + vector store exist, the SAME judge runs over cross-corpus neighbours ("vs
 * what you already know"); only `buildCandidates` widens — the prompt/contract is stable.
 */

import { z } from 'zod';
import type { RelationInsight } from '@/lib/types/knowledge-graph';

export interface StanceDimension {
  number: number;
  name: string;
  content: string;
}

// Fast, free, non-reasoning models. Gemini Flash leads; nemotron is the resilient fallback.
const STANCE_MODELS = [
  'google/gemini-2.0-flash-exp:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
] as const;

const LLMInsightSchema = z.object({
  kind: z.enum(['tangent', 'contrarian']),
  source: z.number().int().min(1).max(11),
  target: z.number().int().min(1).max(11),
  rationale: z.string().min(1).max(280),
});
const LLMResponseSchema = z.object({ insights: z.array(LLMInsightSchema).max(12) });

function buildPrompt(dims: StanceDimension[]): string {
  const roster = dims
    .map((d) => `D${d.number} — ${d.name}: ${d.content.replace(/\s+/g, ' ').slice(0, 320)}`)
    .join('\n');
  return [
    'You analyse the relationships BETWEEN the dimensions of a single video analysis.',
    'Identify up to 6 of the most insightful relationships of two kinds:',
    '- "tangent": dimension A opens an adjacent thread that dimension B leaves unresolved or pulls away from (novel/divergent, not opposed).',
    '- "contrarian": dimensions A and B sit in genuine tension — a claim vs a risk/limitation/counter-point.',
    'Only include relationships supported by the text. Prefer contrarian tensions when they exist.',
    '',
    'DIMENSIONS:',
    roster,
    '',
    'Respond with ONLY minified JSON, no prose, no markdown fences:',
    '{"insights":[{"kind":"tangent|contrarian","source":<D#>,"target":<D#>,"rationale":"<= 22 words"}]}',
  ].join('\n');
}

/** Strip code fences / leading prose and pull the first JSON object. */
function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  return body.slice(start, end + 1);
}

async function callStanceModel(model: string, prompt: string, apiKey: string): Promise<string | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://yt-intel.getmytestdrive.com',
        'X-Title': 'hex-yt-intel',
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 700,
        reasoning: { effort: 'low' },
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Run the stance pass over the analysis dimensions. Returns validated insights with
 * labels resolved. Returns [] on any failure (caller treats it as "no insights yet").
 */
export async function computeStanceRelations(
  dims: StanceDimension[],
  apiKey: string
): Promise<{ insights: RelationInsight[]; model: string }> {
  const usable = dims.filter((d) => d.content && d.content.trim().length >= 12);
  if (usable.length < 2 || !apiKey) return { insights: [], model: 'none' };

  const labelOf = new Map(usable.map((d) => [d.number, d.name]));
  const prompt = buildPrompt(usable);

  for (const model of STANCE_MODELS) {
    const raw = await callStanceModel(model, prompt, apiKey);
    if (!raw) continue;
    const json = extractJson(raw);
    if (!json) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      continue;
    }
    const result = LLMResponseSchema.safeParse(parsed);
    if (!result.success) continue;

    const insights: RelationInsight[] = result.data.insights
      // keep only edges whose endpoints exist and aren't self-loops
      .filter((i) => i.source !== i.target && labelOf.has(i.source) && labelOf.has(i.target))
      .slice(0, 6)
      .map((i) => ({
        kind: i.kind,
        source: i.source,
        target: i.target,
        sourceLabel: labelOf.get(i.source)!,
        targetLabel: labelOf.get(i.target)!,
        rationale: i.rationale.trim(),
      }));

    return { insights, model };
  }

  return { insights: [], model: 'none' };
}
