/**
 * PersistService.ts vs /api/analyses/persist/route.ts — schema selection
 * hypothesis test.
 *
 * Hypothesis: PersistService.settleAnalysis() parses extracted payload using
 * ChunkPayloadSchema (line 124), but the persist route falls back to
 * UCISPayloadV2Schema when chunkIndex is undefined (route line 117-127).
 * Because settleAnalysis does NOT send chunkIndex in the request body
 * (PersistService.ts line 149-158), a chunk-shaped payload (only `dimensions`
 * field) sent through settleAnalysis would FAIL the route's UCISPayloadV2Schema
 * validation → 400.
 *
 * This test runs against the real ZodSchemas (no inline copy) to prove the
 * shape of the failure.
 */
import { describe, it, expect } from 'vitest';
import { UCISPayloadSchema, ChunkPayloadSchema } from '../services/ZodSchemas';

const LocalChunkPayloadSchema = ChunkPayloadSchema;
expect(LocalChunkPayloadSchema).toBeDefined();
expect(typeof LocalChunkPayloadSchema.safeParse).toBe('function');

function makeChunkPayload(dimCount = 11): Record<string, unknown> {
  return {
    schemaVersion: '2.0',
    dimensions: Array.from({ length: dimCount }, (_, i) => ({
      number: i + 1,
      name: `D${i + 1}`,
      content: `Content for dimension ${i + 1}`,
    })),
  };
}

function makeFullPayload(): Record<string, unknown> {
  return {
    schemaVersion: '2.0',
    persona: {
      primary: { id: 'consultant', label: 'Consultant', weight: 1.0 },
      cognitiveLenses: [],
      selectionRationale: 'test',
    },
    dimensions: Array.from({ length: 11 }, (_, i) => ({
      number: i + 1,
      name: `D${i + 1}`,
      content: `Content for dimension ${i + 1}`,
    })),
    knowledgeGraph: { nodes: [], edges: [], rootId: null },
    classification: {
      authoritative: false,
      practicallyActionable: false,
      knowledgeGraphReady: false,
      safe: true,
      personaOptimised: false,
      recommendation: 'conditional',
    },
    monetizationVerdict: null,
  };
}

describe('Persist chain — schema selection at the route boundary', () => {
  describe('ChunkPayloadSchema (worker side)', () => {
    it('accepts a chunk-shaped payload with only dimensions', () => {
      const result = LocalChunkPayloadSchema.safeParse(makeChunkPayload());
      expect(result.success).toBe(true);
    });

    it('accepts a chunk with no persona field', () => {
      const chunk = { schemaVersion: '2.0', dimensions: [] };
      const result = LocalChunkPayloadSchema.safeParse(chunk);
      expect(result.success).toBe(true);
    });

    it('rejects wrong schemaVersion', () => {
      const result = LocalChunkPayloadSchema.safeParse({ schemaVersion: '1.0', dimensions: [] });
      expect(result.success).toBe(false);
    });
  });

  describe('UCISPayloadV2Schema (Vercel route side, baseline path)', () => {
    it('accepts a full UCISPayloadV2 shape', () => {
      const result = UCISPayloadSchema.safeParse(makeFullPayload());
      expect(result.success).toBe(true);
    });

    it('rejects a chunk-shaped payload (only dimensions, no persona)', () => {
      const chunk = makeChunkPayload();
      const result = UCISPayloadSchema.safeParse(chunk);
      expect(result.success).toBe(false);
      if (!result.success) {
        const issuePaths = result.error.issues.map((i) => i.path.join('.'));
        expect(issuePaths).toContain('persona');
        expect(issuePaths).toContain('classification');
      }
    });

    it('rejects a chunk-shaped payload missing knowledgeGraph', () => {
      const chunk = makeChunkPayload();
      const result = UCISPayloadSchema.safeParse(chunk);
      expect(result.success).toBe(false);
    });
  });

  describe('HYPOTHESIS: settleAnalysis chunk payload sent to baseline path', () => {
    it('route.ts line 117-127 selects UCISPayloadV2Schema when chunkIndex is undefined', () => {
      // The route selects schema based on `isChunk = chunkIndex !== undefined`.
      // settleAnalysis sends body without chunkIndex (PersistService.ts:149-158).
      // Therefore settleAnalysis always routes to UCISPayloadV2Schema baseline.
      const chunk = makeChunkPayload();
      const isChunk = undefined !== undefined; // chunkIndex undefined
      const schema = isChunk ? LocalChunkPayloadSchema : UCISPayloadSchema;
      const result = schema.safeParse(chunk);
      expect(result.success).toBe(false);
    });

    it('route.ts returns 400 if the parsed payload is a chunk without UCIS fields', () => {
      // Simulating route.ts behavior: payload sent without chunkIndex, parsed
      // against UCISPayloadV2Schema → fails → route returns 400 (route.ts:129-137)
      const chunk = makeChunkPayload();
      const parseResult = UCISPayloadSchema.safeParse(chunk);
      expect(parseResult.success).toBe(false);
      // Route returns: NextResponse.json({ error: 'Invalid payload schema' }, { status: 400 })
    });

    it('settleAnalysis would 400 on real chunk-only payloads', () => {
      // settleAnalysis path (worker/src/services/PersistService.ts:109-168):
      //   1. extractJsonPayload parses to chunk-shaped object
      //   2. ChunkPayloadSchema.safeParse() → success
      //   3. POST /api/analyses/persist WITHOUT chunkIndex
      //   4. Route parses payload with UCISPayloadV2Schema → fails
      //   5. Route returns 400
      const chunk = makeChunkPayload();
      const workerResult = LocalChunkPayloadSchema.safeParse(chunk);
      expect(workerResult.success).toBe(true);
      const routeResult = UCISPayloadSchema.safeParse(chunk);
      expect(routeResult.success).toBe(false);
      // CONCLUSION: chunk that succeeds worker-side fails route-side
    });
  });
});