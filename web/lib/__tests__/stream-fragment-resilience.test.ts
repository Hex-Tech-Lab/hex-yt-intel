/**
 * Regression: Carmack crucible (2026-10-03) — the browser rejected live `kg`
 * and `classification` SSE frames ("Fragment validation failed"). Shapes below
 * are the real drift found in analysis_chunks: a node without keyTerms, and a
 * classification carrying `personaIndicatorIdentified` instead of
 * `personaOptimised`.
 */
import { describe, expect, it } from 'vitest';
import { ClassificationDataSchema, validateFragment } from '../validators/synthesis';

const node = (id: string, extra: Record<string, unknown> = {}) => ({
  id, label: id.toUpperCase(), weight: 8, polarity: 1, dimension: 8,
  keyTerms: ['x'], entityType: 'concept', ...extra,
});

describe('kg fragment resilience', () => {
  it('accepts a graph where one node has no keyTerms, defaulting to []', () => {
    const { keyTerms: _omit, ...bare } = node('n2');
    const r = validateFragment({ type: 'kg', nodes: [node('n1'), bare], edges: [], rootId: null });
    expect(r.success).toBe(true);
    if (r.success && r.data.type === 'kg') {
      expect(r.data.nodes).toHaveLength(2);
      expect(r.data.nodes[1]!.keyTerms).toEqual([]);
    }
  });

  it('accepts rootId null or missing without dropping nodes/edges', () => {
    const edges = [{ source: 'n1', target: 'n2', strength: 9, kind: 'enables', rationale: 'Ray casting underlies it' }];
    for (const rootId of [null, undefined]) {
      const r = validateFragment({ type: 'kg', nodes: [node('n1'), node('n2')], edges, rootId });
      expect(r.success).toBe(true);
      if (r.success && r.data.type === 'kg') {
        expect(r.data.nodes).toHaveLength(2);
        expect(r.data.edges).toHaveLength(1);
        expect(r.data.rootId).toBeNull();
      }
    }
  });

  it('negative control: still rejects nodes that is not an array', () => {
    expect(validateFragment({ type: 'kg', nodes: 'nope', edges: [], rootId: null }).success).toBe(false);
  });
});

describe('classification fragment resilience', () => {
  const base = { authoritative: true, practicallyActionable: true, knowledgeGraphReady: true, safe: true, recommendation: 'highly_recommended' };

  it('maps personaIndicatorIdentified to personaOptimised (live crucible shape)', () => {
    const r = validateFragment({ type: 'classification', data: { ...base, personaIndicatorIdentified: true } });
    expect(r.success).toBe(true);
    if (r.success && r.data.type === 'classification') {
      expect(r.data.data.personaOptimised).toBe(true);
      expect(r.data.data).not.toHaveProperty('personaIndicatorIdentified');
    }
  });

  it('canonical key wins over its alias regardless of order', () => {
    const r = ClassificationDataSchema.safeParse({ personaOptimised: false, ...base, personaIndicatorIdentified: true });
    expect(r.success && r.data.personaOptimised).toBe(false);
  });

  it('tolerates missing/null qualifiers, string booleans, unknown keys and "Highly Recommended"', () => {
    const r = ClassificationDataSchema.safeParse({ safe: 'true', authoritative: null, recommendation: 'Highly Recommended', rationale: 'extra' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.safe).toBe(true);
      expect(r.data.recommendation).toBe('highly_recommended');
      expect(r.data.practicallyActionable).toBeUndefined();
      expect(r.data).not.toHaveProperty('rationale');
    }
  });

  it('negative control: rejects a missing or unknown recommendation', () => {
    expect(ClassificationDataSchema.safeParse({ ...base, recommendation: undefined }).success).toBe(false);
    expect(ClassificationDataSchema.safeParse({ ...base, recommendation: 'must_watch' }).success).toBe(false);
  });

  it('negative control: rejects a non-boolean qualifier like "maybe"', () => {
    expect(ClassificationDataSchema.safeParse({ ...base, safe: 'maybe' }).success).toBe(false);
  });
});

describe('markdown reconstruction with nullish qualifiers', () => {
  it('omits null qualifiers instead of printing "null"', async () => {
    const { reconstructMarkdown } = await import('../utils/markdown-reconstructor');
    const md = reconstructMarkdown({ schemaVersion: '2.0', dimensions: [], classification: { safe: null, authoritative: true, recommendation: 'recommended' } } as never);
    expect(md).toContain('Authoritative:** true');
    expect(md).not.toContain('null');
  });
});

describe('stitch persists the normalized classification and graph', () => {
  it('maps the alias, coerces string booleans and defaults keyTerms in the persisted payload', async () => {
    const { stitchChunksIntoPayload } = await import('../services/stitch-analysis-chunks');
    const grounded = {
      schemaVersion: '2.0',
      dimensions: [{ number: 8, name: 'SEMANTIC', content: '## 8.1\nGrounded semantic content, well over ten characters long.' }],
      persona: { primary: { id: 'creator', label: 'Creator', weight: 1 }, cognitiveLenses: ['default'], selectionRationale: 'Test selection rationale, long enough.' },
      knowledgeGraph: { nodes: [{ id: 'n1', label: 'Entity', weight: 8, entityType: 'concept' }], edges: [], rootId: 'n1' },
      classification: { authoritative: true, practicallyActionable: true, knowledgeGraphReady: true, safe: 'true', personaIndicatorIdentified: true, recommendation: 'Highly Recommended' },
    };
    const { payload, validationPassed } = stitchChunksIntoPayload(new Map([[4, grounded]]), 5);
    expect(validationPassed).toBe(true);
    const cls = (payload as any).classification;
    expect(cls.personaOptimised).toBe(true);
    expect(cls).not.toHaveProperty('personaIndicatorIdentified');
    expect(cls.safe).toBe(true);
    expect(cls.recommendation).toBe('highly_recommended');
    expect((payload as any).knowledgeGraph.nodes[0].keyTerms).toEqual([]);
  });
});
