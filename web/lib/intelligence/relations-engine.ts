import { z } from 'zod';
import type { RelationInsight } from '@/lib/types/knowledge-graph';
import { resolveStanceCascade } from '@/lib/config/cascade';
import { translateModelId } from '@/lib/utils/model-id-translator';

// See /docs/intelligence/relations-engine.md
export interface StanceDimension {
  number: number;
  name: string;
  content: string;
}

const sanitizeDimensionNumber = (val: unknown): number => {
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (typeof val === 'string') {
    const digits = val.replace(/\D/g, '');
    const parsed = parseInt(digits, 10);
    return isNaN(parsed) ? 1 : parsed;
  }
  return 1;
};

const LLMInsightSchema = z.object({
  kind: z.enum(['tangent', 'contrarian']),
  source: z.preprocess(sanitizeDimensionNumber, z.number().int().min(1).max(11)),
  target: z.preprocess(sanitizeDimensionNumber, z.number().int().min(1).max(11)),
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
    '- "tangent": dimension A opens an adjacent thread that dimension B leaves unresolved or pulls away from.',
    '- "contrarian": dimensions A and B sit in genuine tension — a claim vs a risk/limitation.',
    'DIMENSIONS:',
    roster,
    'Respond with ONLY minified JSON, no prose:',
    '{"insights":[{"kind":"tangent|contrarian","source":<D#>,"target":<D#>,"rationale":"<= 22 words"}]}',
  ].join('\n');
}

function extractJson(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start, end + 1);
}

async function* callStanceModelStream(
  model: string,
  prompt: string,
  apiKey: string,
  handshakeTimeoutMs: number = 8000,
  externalSignal?: AbortSignal,
  providerOrder?: string[]
): AsyncGenerator<string> {
  const controller = new AbortController();
  const handshakeTimer = setTimeout(() => controller.abort(), handshakeTimeoutMs);

  // Listen to external signal (e.g., from route handler) and abort if signaled
  const abortListener = () => controller.abort();
  if (externalSignal) {
    externalSignal.addEventListener('abort', abortListener);
  }

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://yt-intel.getmytestdrive.com',
        'X-Title': 'hex-yt-intel / stance-relations',
      },
      body: JSON.stringify({
        model: translateModelId(model),
        temperature: 0.3,
        max_tokens: 700,
        stream: true,
        reasoning: { effort: 'low' },
        messages: [{ role: 'user', content: prompt }],
        provider: {
          sort: 'latency',
          allow_fallbacks: false,
          ...(providerOrder ? { order: providerOrder } : {}),
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(handshakeTimer);
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      console.warn(`[relations/engine] Model ${model} returned HTTP ${res.status}:`, errText.slice(0, 200));
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') break;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch { /* ignore parse errors in chunks */ }
      }
    }
  } catch (err) {
    const isAbort = (err as Error)?.name === 'AbortError';
    console.warn(`[relations/engine] Model ${model} ${isAbort ? 'handshake timed out (8s)' : 'failed'}:`, err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(handshakeTimer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', abortListener);
    }
  }
}

export async function* computeStanceRelationsStream(
  dims: StanceDimension[],
  apiKey: string,
  handshakeSignal?: AbortSignal
): AsyncGenerator<{ type: 'insight', insight: RelationInsight } | { type: 'model', model: string }> {
  const usable = dims.filter((d) => d.content && d.content.trim().length >= 12);
  if (usable.length < 2 || !apiKey) return;

  const labelOf = new Map(usable.map((d) => [d.number, d.name]));
  const prompt = buildPrompt(usable);
  const stanceModels = await resolveStanceCascade();

  for (let idx = 0; idx < stanceModels.length; idx++) {
    const item = stanceModels[idx]!;
    if (handshakeSignal?.aborted) {
      console.warn(`[relations/engine] Handshake signal aborted before attempting model: ${item.model}`);
      break;
    }

    console.log(`[relations/engine] Cascade attempt ${idx + 1}/${stanceModels.length}: ${item.name} (${item.model})`);
    yield { type: 'model', model: item.model };
    let fullText = '';

    try {
      for await (const delta of callStanceModelStream(
        item.model,
        prompt,
        apiKey,
        8000,
        handshakeSignal,
        item.providerOrder as string[] | undefined
      )) {
        fullText += delta;
      }
    } catch (err) {
      console.warn(`[relations/engine] Model ${item.model} exception, falling to next cascade model:`, err instanceof Error ? err.message : String(err));
      continue;
    }

    const json = extractJson(fullText);
    if (!json) {
      console.warn(`[relations/engine] Model ${item.model} returned no valid JSON; trying next cascade model`);
      continue;
    }

    try {
      const parsed = JSON.parse(json);
      const result = LLMResponseSchema.safeParse(parsed);
      if (result.success) {
        const insights = result.data.insights
          .filter((i) => i.source !== i.target && labelOf.has(i.source) && labelOf.has(i.target))
          .slice(0, 6);
        
        console.log(`[relations/engine] Successfully extracted ${insights.length} stance relation insights using ${item.model}`);
        for (const i of insights) {
          yield {
            type: 'insight',
            insight: {
              kind: i.kind,
              source: i.source,
              target: i.target,
              sourceLabel: labelOf.get(i.source)!,
              targetLabel: labelOf.get(i.target)!,
              rationale: i.rationale.trim(),
            }
          };
        }
        return; // Success, stop cascade
      } else {
        console.warn(`[relations/engine] Model ${item.model} JSON schema validation failed:`, result.error.format());
      }
    } catch (parseErr) {
      console.warn(`[relations/engine] Model ${item.model} JSON parse failed:`, parseErr);
      continue;
    }
  }

  console.warn('[relations/engine] All cascade models exhausted without valid stance relations output');
}


