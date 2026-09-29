/**
 * R1b (2026-09-29) — Cross-Domain Bridges (sub-dimension 8.3) stitch tests.
 *
 * The projective bundle (dims 9/11) emits sub-dimension 8.3 Cross-Domain
 * Bridges as a top-level `crossDomainBridges` root field because it belongs
 * to no emitted dimension object. stitchChunksIntoPayload must pick it up
 * (first non-empty wins, mirroring monetizationVerdict) and append it into
 * dimension 8's content, capped at the registry key
 * analysis.layer2.crossDomainBridgesMaxChars (code fallback 4000).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { stitchChunksIntoPayload, truncateBridges } from '@/lib/services/stitch-analysis-chunks';

function groundedPayload(dimNumber = 8): Record<string, unknown> {
  return {
    schemaVersion: '2.0',
    dimensions: [
      {
        number: dimNumber,
        name: dimNumber === 8 ? 'SEMANTIC & KNOWLEDGE GRAPH FOUNDATION' : 'APEX INTELLIGENCE',
        content: dimNumber === 8
          ? '## 8.1\nGrounded semantic content, well over ten characters long.'
          : '## 1.1\nGrounded apex content, well over ten characters long.',
      },
    ],
    persona: {
      primary: { id: 'creator', label: 'Creator', weight: 1.0 },
      cognitiveLenses: ['default'],
      selectionRationale: 'Test selection rationale, well over ten characters.',
    },
    knowledgeGraph: {
      nodes: [{ id: 'node-1', dimension: dimNumber, label: 'Test Entity', content: 'A test entity with content.', entityType: 'concept', weight: 8, polarity: 0.5, keyTerms: ['test'] }],
      edges: [{ source: 'node-1', target: 'node-1', relation: 'relates to', strength: 5, sourceDimension: dimNumber, targetDimension: dimNumber }],
      rootId: 'node-1',
    },
    classification: {
      authoritative: true,
      practicallyActionable: true,
      knowledgeGraphReady: true,
      safe: true,
      personaOptimised: true,
      recommendation: 'conditional',
    },
  };
}

function projectivePayload(bridges?: string): Record<string, unknown> {
  return {
    schemaVersion: '2.0',
    dimensions: [
      { number: 9, name: 'FORWARD FORESIGHT', content: 'Foresight content that comfortably exceeds ten characters.' },
      { number: 11, name: 'COMMERCIAL YIELD & MONETIZATION PROFILING', content: 'Yield content that comfortably exceeds ten characters.' },
    ],
    ...(bridges ? { crossDomainBridges: bridges } : {}),
  };
}

function chunk(index: number, payload: Record<string, unknown>) {
  return [index, payload] as const;
}

type Fixture = { dimensions: Array<{ number: number; name?: string; content: string }> } & Record<string, unknown>;
const bridgesOf = (payload: unknown): string | undefined =>
  (payload as { crossDomainBridges?: string } | null)?.crossDomainBridges;

describe('crossDomainBridges stitch rule (R1b)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockRestore();
    vi.spyOn(console, 'error').mockRestore();
  });

  it('stitches crossDomainBridges into dimension 8 under the 8.3 heading, and not also on the root', () => {
    const chunkMap = new Map<number, Record<string, unknown>>([
      chunk(4, groundedPayload()),
      chunk(5, projectivePayload('- Bridge one')),
    ]);
    const { payload, validationPassed } = stitchChunksIntoPayload(chunkMap, 5);
    expect(validationPassed).toBe(true);
    const dim8 = payload!.dimensions.find((d) => d.number === 8)!;
    const grounded = dim8.content.indexOf('Grounded semantic content, well over ten characters long.');
    const heading = dim8.content.indexOf('#### 8.3 Cross-Domain Bridges');
    expect(grounded).toBeGreaterThanOrEqual(0);
    expect(heading).toBeGreaterThan(grounded); // grounded content first, never reordered
    expect(dim8.content.indexOf('Bridge one')).toBeGreaterThan(heading);
    // Root field only survives when dim 8 is missing (see degraded-case test).
    expect(bridgesOf(payload)).toBeUndefined();
  });

  it('inserts 8.3 before an existing 8.4 heading so sub-sections read 8.1 → 8.4 in order', () => {
    const grounded = groundedPayload() as unknown as Fixture;
    grounded.dimensions[0].content = '#### 8.1 Nodes\nNode text long enough.\n\n#### 8.2 Relations\nRelation text.\n\n#### 8.4 Discovery Pathways\nPathway text.';
    const chunkMap = new Map<number, Record<string, unknown>>([chunk(4, grounded), chunk(5, projectivePayload('- Bridge one'))]);
    const dim8 = stitchChunksIntoPayload(chunkMap, 5).payload!.dimensions.find((d) => d.number === 8)!;
    const order = ['#### 8.1', '#### 8.2', '#### 8.3 Cross-Domain Bridges', '#### 8.4'].map((h) => dim8.content.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((i, j) => i - j)).toEqual(order);
  });

  it('never inserts 8.3 twice when dimension 8 already carries it', () => {
    const grounded = groundedPayload() as unknown as Fixture;
    grounded.dimensions[0].content += '\n\n#### 8.3 Cross-Domain Bridges\nAlready present.';
    const chunkMap = new Map<number, Record<string, unknown>>([chunk(4, grounded), chunk(5, projectivePayload('- Bridge one'))]);
    const dim8 = stitchChunksIntoPayload(chunkMap, 5).payload!.dimensions.find((d) => d.number === 8)!;
    expect(dim8.content.split('8.3 Cross-Domain Bridges').length - 1).toBe(1);
  });

  it('first non-empty crossDomainBridges wins across chunks', () => {
    const chunkMap = new Map<number, Record<string, unknown>>([
      chunk(4, groundedPayload()),
      chunk(5, projectivePayload('## Cross-Domain Bridges\n\nFirst version payload value')),
      chunk(4, groundedPayload(1)), // second grounded chunk (dim 1), no bridges — replaces index 4
      chunk(6, projectivePayload('## Cross-Domain Bridges\n\nSecond version payload value')),
    ]);
    const { payload } = stitchChunksIntoPayload(chunkMap, 6);
    expect(bridgesOf(payload)).toContain('First version payload value');
    expect(bridgesOf(payload)).not.toContain('Second version');
  });

  it('ignores empty/whitespace crossDomainBridges values', () => {
    const chunkMap = new Map<number, Record<string, unknown>>([
      chunk(4, groundedPayload()),
      chunk(5, projectivePayload('   ')),
    ]);
    const { payload } = stitchChunksIntoPayload(chunkMap, 5);
    expect(bridgesOf(payload)).toBeUndefined();
    const dim8 = payload!.dimensions.find((d) => d.number === 8);
    expect(dim8!.content).not.toContain('Cross-Domain Bridges');
  });

  it('truncates over-cap bridges with a visible marker (custom cap)', () => {
    const long = 'x'.repeat(500);
    const chunkMap = new Map<number, Record<string, unknown>>([
      chunk(4, groundedPayload()),
      chunk(5, projectivePayload(long)),
    ]);
    const { payload } = stitchChunksIntoPayload(chunkMap, 5, undefined, 300);
    const dim8 = payload!.dimensions.find((d) => d.number === 8)!;
    expect(dim8.content).toContain('truncated at 300 characters');
    expect(dim8.content).toContain('x'.repeat(300));
    expect(dim8.content).not.toContain('x'.repeat(301)); // cap enforced, not just labelled
  });

  it('keeps bridges on the payload root (warns) when dimension 8 never arrives', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const groundedOnly = groundedPayload(1);
    (groundedOnly as unknown as Fixture).dimensions = [
      { number: 1, name: 'APEX INTELLIGENCE', content: 'Apex content that comfortably exceeds ten characters.' },
    ];
    const chunkMap = new Map<number, Record<string, unknown>>([
      chunk(1, groundedOnly),
      chunk(5, projectivePayload('## Cross-Domain Bridges\n\nOrphaned bridges')),
    ]);
    const { payload } = stitchChunksIntoPayload(chunkMap, 5);
    // No fabricated dim-8 object.
    expect(payload!.dimensions.find((d) => d.number === 8)).toBeUndefined();
    expect(bridgesOf(payload)).toContain('Orphaned bridges');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('dimension 8 missing'),
    );
  });
});

describe('truncateBridges', () => {
  afterEach(() => vi.restoreAllMocks());

  it('passes through under-cap markdown unchanged', () => {
    expect(truncateBridges('short', 4000)).toBe('short');
  });

  it('uses the 4000 fallback cap when maxChars is undefined or invalid', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(truncateBridges('a'.repeat(4001))).toContain('truncated at 4000 characters');
    expect(truncateBridges('a'.repeat(4001), Number.NaN)).toContain('truncated at 4000 characters');
    expect(truncateBridges('a'.repeat(4001), -5)).toContain('truncated at 4000 characters');
    expect(warnSpy).toHaveBeenCalled();
  });

  describe('R1e: 8.4 Discovery Pathways (projective)', () => {
    const projectiveWith84 = (extra: Record<string, unknown> = {}) => ({
      ...projectivePayload('- Bridge one'),
      discoveryPathways: 'Named by speaker: Book A\n> [EXTERNAL_PROJECTION]\n1. Research B',
      ...extra,
    });
    const groundedWithResources = () => ({ ...groundedPayload(), explicitSpeakerResources: ['Book A'] });

    it('dimension 8 reads 8.1 -> 8.2 -> 8.3 -> 8.4 in order', () => {
      const grounded = groundedWithResources() as unknown as Fixture;
      grounded.dimensions[0]!.content = '#### 8.1 Nodes\nNode text long enough.\n\n#### 8.2 Relations\nRelation text.';
      const chunkMap = new Map<number, Record<string, unknown>>([chunk(4, grounded), chunk(5, projectiveWith84())]);
      const dim8 = stitchChunksIntoPayload(chunkMap, 5).payload!.dimensions.find((d) => d.number === 8)!;
      const order = ['#### 8.1', '#### 8.2', '#### 8.3 Cross-Domain Bridges', '#### 8.4 Discovery Pathways'].map((h) => dim8.content.indexOf(h));
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((i, j) => i - j)).toEqual(order);
      expect(dim8.content).toContain('> [EXTERNAL_PROJECTION]');
    });

    it('REPLACES a legacy grounded 8.4 with the projective one (external recs + delimiter always land)', () => {
      const grounded = groundedWithResources() as unknown as Fixture;
      grounded.dimensions[0]!.content = '#### 8.1 Nodes\nNode text long enough.\n\n#### 8.2 Relations\nRelation text.\n\n#### 8.4 Discovery Pathways\nN/A -- no resources/further reading named in transcript';
      const chunkMap = new Map<number, Record<string, unknown>>([chunk(4, grounded), chunk(5, projectiveWith84())]);
      const dim8 = stitchChunksIntoPayload(chunkMap, 5).payload!.dimensions.find((d) => d.number === 8)!;
      expect(dim8.content).not.toContain('N/A -- no resources/further reading named in transcript');
      expect(dim8.content).toContain('> [EXTERNAL_PROJECTION]');
      expect(dim8.content.split('8.4 Discovery Pathways').length - 1).toBe(1);
      const order = ['#### 8.1', '#### 8.2', '#### 8.3 Cross-Domain Bridges', '#### 8.4 Discovery Pathways'].map((h) => dim8.content.indexOf(h));
      expect([...order].sort((i, j) => i - j)).toEqual(order);
    });

    it('appends 8.4 AFTER 8.1/8.2 when no 8.3 section exists (never above 8.1)', () => {
      const grounded = groundedPayload() as unknown as Fixture;
      grounded.dimensions[0]!.content = '#### 8.1 Nodes\nNode text long enough.\n\n#### 8.2 Relations\nRelation text.';
      const projectiveNoBridges = { ...projectivePayload(), discoveryPathways: 'Named: none\n> [EXTERNAL_PROJECTION]\n1. Research B' };
      const chunkMap = new Map<number, Record<string, unknown>>([chunk(4, grounded), chunk(5, projectiveNoBridges)]);
      const dim8 = stitchChunksIntoPayload(chunkMap, 5).payload!.dimensions.find((d) => d.number === 8)!;
      expect(dim8.content.indexOf('#### 8.4 Discovery Pathways')).toBeGreaterThan(dim8.content.indexOf('#### 8.2'));
      expect(dim8.content.indexOf('#### 8.1')).toBeLessThan(dim8.content.indexOf('#### 8.4 Discovery Pathways'));
    });

    it('never inserts 8.4 twice', () => {
      const grounded = groundedWithResources() as unknown as Fixture;
      grounded.dimensions[0]!.content += '\n\n#### 8.4 Discovery Pathways\nAlready present.';
      const chunkMap = new Map<number, Record<string, unknown>>([chunk(4, grounded), chunk(5, projectiveWith84())]);
      const dim8 = stitchChunksIntoPayload(chunkMap, 5).payload!.dimensions.find((d) => d.number === 8)!;
      expect(dim8.content.split('8.4 Discovery Pathways').length - 1).toBe(1);
    });

    it('strips the intermediate explicitSpeakerResources from the stitched payload', () => {
      const chunkMap = new Map<number, Record<string, unknown>>([chunk(4, groundedWithResources()), chunk(5, projectiveWith84())]);
      const { payload } = stitchChunksIntoPayload(chunkMap, 5);
      expect((payload as unknown as Record<string, unknown>).explicitSpeakerResources).toBeUndefined();
      expect((payload as unknown as Record<string, unknown>).discoveryPathways).toBeUndefined(); // merged into dim 8, not kept on root
    });

    it('legacy row: grounded dim 8 that already carries an 8.4 heading still gets 8.3 inserted before it', () => {
      const grounded = groundedPayload() as unknown as Fixture;
      grounded.dimensions[0]!.content = '#### 8.1 Nodes\nNode text long enough.\n\n#### 8.2 Relations\nRelation text.\n\n#### 8.4 Discovery Pathways\nLegacy grounded pathways.';
      const chunkMap = new Map<number, Record<string, unknown>>([chunk(4, grounded), chunk(5, projectivePayload('- Bridge one'))]);
      const dim8 = stitchChunksIntoPayload(chunkMap, 5).payload!.dimensions.find((d) => d.number === 8)!;
      expect(dim8.content.indexOf('#### 8.3 Cross-Domain Bridges')).toBeLessThan(dim8.content.indexOf('#### 8.4 Discovery Pathways'));
    });
  });
});

