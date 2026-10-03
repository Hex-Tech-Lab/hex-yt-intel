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
    const result = validateFragment({ type: 'kg', nodes: [node('n1'), bare], edges: [], rootId: null });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'kg') {
      expect(result.data.nodes).toHaveLength(2);
      expect(result.data.nodes[1]!.keyTerms).toEqual([]);
    }
  });

  it('accepts rootId null or missing without dropping nodes/edges', () => {
    const edges = [{ source: 'n1', target: 'n2', strength: 9, kind: 'enables', rationale: 'Ray casting underlies it' }];
    for (const rootId of [null, undefined]) {
      const result = validateFragment({ type: 'kg', nodes: [node('n1'), node('n2')], edges, rootId });
      expect(result.success).toBe(true);
      if (result.success && result.data.type === 'kg') {
        expect(result.data.nodes).toHaveLength(2);
        expect(result.data.edges).toHaveLength(1);
        expect(result.data.rootId).toBeNull();
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
    const result = validateFragment({ type: 'classification', data: { ...base, personaIndicatorIdentified: true } });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'classification') {
      expect(result.data.data.personaOptimised).toBe(true);
      expect(result.data.data).not.toHaveProperty('personaIndicatorIdentified');
    }
  });

  it('canonical key wins over its alias regardless of order', () => {
    const result = ClassificationDataSchema.safeParse({ personaOptimised: false, ...base, personaIndicatorIdentified: true });
    expect(result.success && result.data.personaOptimised).toBe(false);
  });

  it('tolerates missing/null qualifiers, string booleans, unknown keys and "Highly Recommended"', () => {
    const result = ClassificationDataSchema.safeParse({ safe: 'true', authoritative: null, recommendation: 'Highly Recommended', rationale: 'extra' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.safe).toBe(true);
      expect(result.data.recommendation).toBe('highly_recommended');
      expect(result.data.practicallyActionable).toBeUndefined();
      expect(result.data).not.toHaveProperty('rationale');
    }
  });

  it('negative control: rejects a missing or unknown recommendation', () => {
    expect(ClassificationDataSchema.safeParse({ ...base, recommendation: undefined }).success).toBe(false);
    expect(ClassificationDataSchema.safeParse({ ...base, recommendation: 'must_watch' }).success).toBe(false);
  });

  it('negative control: rejects a non-boolean qualifier like "maybe"', () => {
    expect(ClassificationDataSchema.safeParse({ ...base, safe: 'maybe' }).success).toBe(false);
  });

  it('coerces case/padding-drifted string booleans ("True", " FALSE ")', () => {
    const result = ClassificationDataSchema.safeParse({ ...base, safe: 'True', authoritative: ' FALSE ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.safe).toBe(true);
      expect(result.data.authoritative).toBe(false);
    }
  });
});

describe('kg keyTerms provenance', () => {
  it('preserves a single string keyTerm as a one-element array', () => {
    const result = validateFragment({
      type: 'kg',
      nodes: [node('n1', { keyTerms: ' ray casting ' })],
      edges: [],
      rootId: null,
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'kg') {
      expect(result.data.nodes[0]!.keyTerms).toEqual(['ray casting']);
    }
  });

  it('degrades a non-array non-string keyTerms (number) to []', () => {
    const result = validateFragment({
      type: 'kg',
      nodes: [node('n1', { keyTerms: 42 })],
      edges: [],
      rootId: null,
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'kg') {
      expect(result.data.nodes[0]!.keyTerms).toEqual([]);
    }
  });
});

describe('restore path validates classification', () => {
  it('normalize an alias/string-bool row via the store initializeAnalysis restore entry point', async () => {
    const { useSynthesisNucleus } = await import('@/lib/stores/synthesis-nucleus-store');
    const { useAnalysisMetadataStore } = await import('@/lib/stores/analysis-metadata-store');
    useSynthesisNucleus.getState().reset();
    useSynthesisNucleus.getState().initializeAnalysis({
      analysisPayload: {
        classification: {
          authoritative: true,
          practicallyActionable: true,
          knowledgeGraphReady: true,
          safe: 'true',
          personaIndicatorIdentified: true,
          recommendation: 'Highly Recommended',
        },
      },
    } as never);
    const cls = useAnalysisMetadataStore.getState().classification;
    expect(cls).not.toBeNull();
    expect(cls!.personaOptimised).toBe(true);
    expect(cls!.safe).toBe(true);
    expect(cls!.recommendation).toBe('highly_recommended');
  });

  it('rejects a garbage classification row on restore instead of setting it', async () => {
    const { useSynthesisNucleus } = await import('@/lib/stores/synthesis-nucleus-store');
    const { useAnalysisMetadataStore } = await import('@/lib/stores/analysis-metadata-store');
    useSynthesisNucleus.getState().reset();
    const before = useAnalysisMetadataStore.getState().classification;
    useSynthesisNucleus.getState().initializeAnalysis({
      analysisPayload: {
        classification: { recommendation: 'must_watch', unknownKey: true },
      },
    } as never);
    expect(useAnalysisMetadataStore.getState().classification).toBe(before);
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
