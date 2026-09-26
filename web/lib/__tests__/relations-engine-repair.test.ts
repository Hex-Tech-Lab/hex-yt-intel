/**
 * Relations-engine trailing-JSON repair contract (PR #322 round-2 P2).
 *
 * The old recovery blindly appended ']}' after the last '}', which could
 * accept a truncated prefix and persist it permanently. The repair is now
 * jsonrepair-based (closes genuinely unbalanced structure) and the repaired
 * output is still fully schema-validated — garbage falls through to the
 * next cascade model instead of being persisted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeStanceRelationsStream } from '@/lib/intelligence/relations-engine';

// Keep the real SDK out of the unit test (Cubic P3, PR #322): the engine's
// schema-validation-drop path calls Sentry.captureMessage.
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock('@/lib/config/cascade', () => ({
  resolveStanceCascade: () => [{ name: 'primary', model: 'test/model-a', providerOrder: undefined }],
}));

vi.mock('@/lib/adapters/SupabaseSettingsAdapter', async () => {
  const { RELATIONS_REGISTRY_FALLBACK } = await import('@/lib/utils/relations-settings');
  return {
    SupabaseSettingsAdapter: {
      getRegistrySettings: (keys: string[]) => {
        const out: Record<string, unknown> = {};
        for (const k of keys) out[k] = (RELATIONS_REGISTRY_FALLBACK as Record<string, unknown>)[k] ?? true;
        return out;
      },
    },
  };
});

const DIMS = [
  { number: 1, name: 'Thesis', content: 'A thesis with enough content to be usable here.' },
  { number: 2, name: 'Risk', content: 'A risk with enough content to be usable here.' },
];

const sseResponse = (deltas: string[]): Response => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const delta of deltas) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
};

const GOOD_TAIL = '"rationale":"real words here"}]}';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('relations-engine trailing-JSON repair', () => {
  it('complete JSON parses without any repair', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([`{"insights":[{"kind":"tangent","source":1,"target":2,${GOOD_TAIL}`])
    );
    const insights = [];
    for await (const chunk of computeStanceRelationsStream(DIMS, 'key')) {
      if (chunk.type === 'insight') insights.push(chunk.insight);
    }
    expect(insights).toHaveLength(1);
    expect(insights[0]).toMatchObject({ kind: 'tangent', source: 1, target: 2 });
  });

  it('truncation shape A — stream cut inside the final object: repair closes structure, valid insights survive', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse([
        '{"insights":[{"kind":"contrarian","source":2,"target":1,"rationale":"valid one"},' +
          '{"kind":"tangent","source":1,"target":2,"rationale":"cut of',
      ])
    );
    const insights = [];
    for await (const chunk of computeStanceRelationsStream(DIMS, 'key')) {
      if (chunk.type === 'insight') insights.push(chunk.insight);
    }
    // The completed first insight must survive; the truncated second is
    // either repaired into a valid insight or dropped — never a crash and
    // never the old blind-append acceptance of arbitrary garbage.
    expect(insights.length).toBeGreaterThanOrEqual(1);
    expect(insights[0]).toMatchObject({ kind: 'contrarian', source: 2, target: 1 });
  });

  it('truncation shape B — stream cut before any object closes: falls through with no insights (nothing persisted)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse(['{"insights":[{"kind":"tangent","source":1,"target":2,"rat'])
    );
    const insights = [];
    for await (const chunk of computeStanceRelationsStream(DIMS, 'key')) {
      if (chunk.type === 'insight') insights.push(chunk.insight);
    }
    expect(insights).toHaveLength(0);
  });

  it('repair output is schema-validated: structurally-repaired garbage yields no insights', async () => {
    // Repairs into valid JSON but fails the insight schema (bad kind enum).
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      sseResponse(['{"insights":[{"kind":"nonsense","source":99,"target":1,"rationale":"x"}]'])
    );
    const insights = [];
    for await (const chunk of computeStanceRelationsStream(DIMS, 'key')) {
      if (chunk.type === 'insight') insights.push(chunk.insight);
    }
    expect(insights).toHaveLength(0);
  });
});
