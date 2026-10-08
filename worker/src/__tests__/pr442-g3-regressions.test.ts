import { describe, it, expect, vi } from 'vitest';
import { GroundedExtractionEngine, GroundedExtractionError } from '../services/GroundedExtractionEngine';
import { ProjectiveSynthesisEngine, ProjectiveSynthesisError } from '../services/ProjectiveSynthesisEngine';
import { PromptBuilder } from '../services/PromptBuilder';
import type { GroundedExtractionInput } from '../services/GroundedExtractionEngine';
import type { GroundedExtractionPayload } from '../types/grounded-extraction';

const metadata: GroundedExtractionInput['metadata'] = {
  speakerCount: 2,
  durationSeconds: 300,
  classification: 'S4',
};

describe('PR #442 group-3 regressions (GroundedExtractionEngine)', () => {
  it('does not let the model override the sensor-router classification (i24)', () => {
    const payload = GroundedExtractionEngine.parseAndValidate(
      JSON.stringify({
        claims: [],
        unknowns: ['x'],
        metadata: { classification: 'S1', speakerCount: 7 },
      }),
      metadata,
    );
    expect(payload.metadata.classification).toBe('S4');
    expect(payload.metadata.speakerCount).toBe(7);
  });

  it('rejects an empty extraction payload with no claims and no unknowns (i25)', () => {
    expect(() => GroundedExtractionEngine.parseAndValidate('{}', metadata)).toThrow(GroundedExtractionError);
  });

  it('accepts a no-claims payload when the model declared unknowns', () => {
    const payload = GroundedExtractionEngine.parseAndValidate(
      JSON.stringify({ claims: [], unknowns: ['all'], metadata }),
      metadata,
    );
    expect(payload.claims).toHaveLength(0);
    expect(payload.unknowns).toEqual(['all']);
  });

  it('disambiguates duplicate model-supplied claim IDs (i28)', () => {
    const payload = GroundedExtractionEngine.parseAndValidate(
      JSON.stringify({
        claims: [
          { id: 'claim_01', timestampRange: [0, 1], verbatimQuote: 'a' },
          { id: 'claim_01', timestampRange: [2, 3], verbatimQuote: 'b' },
        ],
        unknowns: [],
        metadata,
      }),
      metadata,
    );
    const ids = payload.claims.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('claim_01');
    expect(ids[1]).not.toBe('claim_01');
  });

  it('scores a missing confidence as 0.5, never as certainty (i29)', () => {
    const payload = GroundedExtractionEngine.parseAndValidate(
      JSON.stringify({
        claims: [{ id: 'claim_01', timestampRange: [0, 1], verbatimQuote: 'a' }],
        unknowns: [],
        metadata,
      }),
      metadata,
    );
    expect(payload.claims[0]?.confidence).toBe(0.5);
  });
});

describe('PR #442 group-3 regressions (ProjectiveSynthesisEngine)', () => {
  const groundedPayload: GroundedExtractionPayload = {
    claims: [{ id: 'claim_01', timestampRange: [0, 1], verbatimQuote: 'a', atomicAssertion: 'x', confidence: 0.9 }],
    unknowns: [],
    metadata: { speakerCount: 1, durationSeconds: 60, classification: 'S1' },
  };

  const parse = (raw: string) =>
    ProjectiveSynthesisEngine.parseAndValidate(raw, groundedPayload, 'creator');

  it('rejects a synthesis payload whose synthesis object is empty (i34)', () => {
    expect(() => parse(JSON.stringify({ synthesis: {} }))).toThrow(ProjectiveSynthesisError);
  });

  it('rejects a coreThesis that cites no valid claim ID (i26)', () => {
    const raw = JSON.stringify({
      synthesis: {
        coreThesis: 'Big things ahead [claim_99] and [claim_88].',
        projections: [
          { id: 'p1', citedClaimIds: ['claim_01'], implication: 'x', marketHorizon: 'near-term', confidence: 0.9 },
        ],
        unsupportedQuestions: [],
      },
    });
    expect(() => parse(raw)).toThrow(/coreThesis without citing any valid/);
  });

  it('accepts a coreThesis citing a valid claim ID', () => {
    const raw = JSON.stringify({
      synthesis: {
        coreThesis: 'Growth is imminent [claim_01].',
        projections: [
          { id: 'p1', citedClaimIds: ['claim_01'], implication: 'x', marketHorizon: 'near-term', confidence: 0.9 },
        ],
        unsupportedQuestions: [],
      },
    });
    const payload = parse(raw);
    expect(payload.synthesis.coreThesis).toContain('claim_01');
    expect(payload.synthesis.projections).toHaveLength(1);
  });

  it('does not crash on a null projection item (i27)', () => {
    const raw = JSON.stringify({
      synthesis: {
        coreThesis: 'x [claim_01]',
        projections: [null, { id: 'p1', citedClaimIds: ['claim_01'], implication: 'x' }],
        unsupportedQuestions: [],
      },
    });
    const payload = parse(raw);
    expect(payload.synthesis.projections).toHaveLength(1);
    expect(payload.synthesis.projections[0]?.id).toBe('p1');
  });
});

describe('PR #442 group-3 regressions (PromptBuilder)', () => {
  const builder = new PromptBuilder();

  const makeChunk = () => [{ text: 'hello', start: 0, end: 1 }];

  it('grounded extraction output example is valid JSON (i23)', () => {
    const { systemPrompt } = builder.buildGroundedExtractionPrompt(makeChunk(), {
      speakerCount: 1,
      durationSeconds: 60,
      classification: 'S1',
    });
    // The prompt tells the model the layout is "valid, raw JSON" -- the
    // example itself must parse, or the model copies an unparseable shape.
    const start = systemPrompt.indexOf('{\n  "claims"');
    expect(start).toBeGreaterThanOrEqual(0);
    let depth = 0;
    let end = start;
    for (let i = start; i < systemPrompt.length; i++) {
      if (systemPrompt[i] === '{') depth++;
      else if (systemPrompt[i] === '}' && --depth === 0) { end = i; break; }
    }
    const example = JSON.parse(systemPrompt.slice(start, end + 1));
    expect(example.claims[0].timestampRange).toEqual([125, 140]);
  });

  it('projective example contains a valid single marketHorizon enum value (i22)', () => {
    const { systemPrompt } = builder.buildProjectiveSynthesisPrompt(
      { claims: [], unknowns: [], metadata: { speakerCount: 1, durationSeconds: 60, classification: 'S1' } },
      'creator',
    );
    expect(systemPrompt).toContain('"marketHorizon": "near-term"');
    expect(systemPrompt).not.toContain('|');
  });

  it('grounded (non-projective) dimension-6 notice does not mandate deductive projections (i35)', async () => {
    const { segmentInstruction } = await builder.buildSegmented({
      videoId: 'x',
      metadata: { title: 't' },
      dimensions: [6],
    } as never);
    expect(segmentInstruction).toContain('6.0 Comparative Scope & Stress-Testing');
    expect(segmentInstruction).not.toContain('deductive projection models');
  });
});
