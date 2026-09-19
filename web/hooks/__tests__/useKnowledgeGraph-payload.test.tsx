/**
 * Unit tests for useKnowledgeGraph's module-level pure payload helpers
 * (PR #315 review round 2 items 2+6, 2026-09-18).
 *
 * mapGraphPayload: validates the top-level /graph payload shape AND every
 * entity/relation item — the first invalid item rejects the WHOLE payload
 * (retryable), never a silent drop or an undefined-id node.
 * classifyFailure: 4xx permanent, everything else retryable.
 *
 * Split from useKnowledgeGraph.test.tsx per the qa-intel 500-line
 * Monolithic File gate. Hook-level end-to-end behavior lives in the
 * main file; these helpers are pure and tested directly.
 */

// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest';
import { mapGraphPayload, classifyFailure } from '@/hooks/useKnowledgeGraph';

describe('graph payload mapping helpers (PR #315 review round 2 items 2+6)', () => {
  const VALID_ENTITY = { id: 'e1', label: 'Transformer', type: 'concept', weight: 3 };

  describe('mapGraphPayload (module-level pure helper)', () => {
    it('maps a fully valid payload to nodes and edges', () => {
      const result = mapGraphPayload({
        entities: [
          { id: 'e1', label: 'Transformer', type: 'concept', weight: 3 },
          { id: 'e2', label: 'Attention', type: 'concept', weight: 1, raw_node: { dimension: 3 } },
        ],
        relations: [{ source_entity_id: 'e1', target_entity_id: 'e2', strength: 0.5, kind: 'co_occurs' }],
      });
      expect(result).not.toBeNull();
      expect(result!.nodes.map((node) => node.id)).toEqual(['e1', 'e2']);
      expect(result!.edges).toEqual([
        { source: 'e1', target: 'e2', strength: 0.5, kind: 'co_occurs' },
      ]);
    });

    it('returns null (empty success, keeps fallback) only for entities: []', () => {
      expect(mapGraphPayload({ entities: [], relations: [] })).toBeNull();
    });

    it('rejects a non-object payload', () => {
      expect(() => mapGraphPayload(null)).toThrow(/malformed payload/);
      expect(() => mapGraphPayload('nope')).toThrow(/malformed payload/);
    });

    it('rejects when entities or relations are missing/not arrays', () => {
      expect(() => mapGraphPayload({})).toThrow(/entities or relations not an array/);
      expect(() => mapGraphPayload({ entities: 'nope', relations: [] })).toThrow(/entities or relations not an array/);
    });

    it('rejects the WHOLE payload when an entity is null or has a missing/invalid id (no silent drop)', () => {
      // Pre-fix: `{ entities: [{}] }` passed the array-only shape check and
      // produced a node with `id: undefined`.
      expect(() => mapGraphPayload({ entities: [{}], relations: [] })).toThrow(/invalid id/);
      expect(() => mapGraphPayload({ entities: [null], relations: [] })).toThrow(/entity is not an object/);
      expect(() => mapGraphPayload({ entities: [{ id: '' }], relations: [] })).toThrow(/invalid id/);
      expect(() => mapGraphPayload({ entities: [{ id: NaN }], relations: [] })).toThrow(/invalid id/);
      // Mixed valid/invalid: the invalid item still rejects everything.
      expect(() => mapGraphPayload({ entities: [VALID_ENTITY, { label: 'no id' }], relations: [] })).toThrow(/invalid id/);
    });

    it('rejects NaN dimensions and weights (typeof NaN === "number" must not pass)', () => {
      expect(() => mapGraphPayload({ entities: [{ id: 'e1', dimension: NaN }], relations: [] }))
        .toThrow(/dimension is not a finite number/);
      expect(() => mapGraphPayload({ entities: [{ id: 'e1', raw_node: { dimension: NaN } }], relations: [] }))
        .toThrow(/dimension is not a finite number/);
      expect(() => mapGraphPayload({ entities: [{ id: 'e1', weight: NaN }], relations: [] }))
        .toThrow(/weight is not a finite number/);
      // Infinity is not finite either.
      expect(() => mapGraphPayload({ entities: [{ id: 'e1', weight: Infinity }], relations: [] }))
        .toThrow(/weight is not a finite number/);
    });

    it('rejects a relation whose endpoints do not reference real node ids (pre-fix: silently dropped)', () => {
      expect(() => mapGraphPayload({
        entities: [VALID_ENTITY],
        relations: [{ source_entity_id: 'e1', target_entity_id: 'ghost' }],
      })).toThrow(/unknown entity id/);
      expect(() => mapGraphPayload({
        entities: [VALID_ENTITY],
        relations: [{ source_entity_id: undefined, target_entity_id: 'e1' }],
      })).toThrow(/unknown entity id/);
      expect(() => mapGraphPayload({ entities: [VALID_ENTITY], relations: [null] }))
        .toThrow(/relation is not an object/);
    });

    it('rejects a non-finite relation strength', () => {
      expect(() => mapGraphPayload({
        entities: [{ id: 'e1' }, { id: 'e2' }],
        relations: [{ source_entity_id: 'e1', target_entity_id: 'e2', strength: NaN }],
      })).toThrow(/strength is not a finite number/);
    });

    it('keeps the established dimension precedence and defaults (behavior preserved)', () => {
      const result = mapGraphPayload({
        entities: [
          { id: 'e1', raw_node: { dimension: 5 }, dimension: 9 },
          { id: 'e2' },
        ],
        relations: [],
      });
      expect(result!.nodes[0].dimension).toBe(5); // raw_node wins
      expect(result!.nodes[1].dimension).toBe(8); // DEFAULT sentinel
    });
  });

  describe('classifyFailure (module-level pure helper)', () => {
    const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

    it('classifies 4xx errors as permanent', () => {
      expect(classifyFailure(httpError(401))).toBe('permanent');
      expect(classifyFailure(httpError(404))).toBe('permanent');
      expect(classifyFailure(httpError(429))).toBe('permanent');
    });

    it('classifies 5xx, network rejects, parse errors, and malformed-body errors as retryable', () => {
      expect(classifyFailure(httpError(500))).toBe('retryable');
      expect(classifyFailure(httpError(503))).toBe('retryable');
      expect(classifyFailure(new TypeError('Failed to fetch'))).toBe('retryable');
      expect(classifyFailure(new SyntaxError('Unexpected token < in JSON'))).toBe('retryable');
      expect(classifyFailure(new Error('graph fetch failed: malformed payload (entity has a missing/invalid id)'))).toBe('retryable');
      expect(classifyFailure(new DOMException('aborted', 'AbortError'))).toBe('retryable');
    });
  });
});
