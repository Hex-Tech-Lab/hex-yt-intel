import { describe, it, expect, vi } from 'vitest';
import {
  GroundedExtractionEngine,
  GroundedExtractionError,
  type GroundedExtractionInput,
} from '../services/GroundedExtractionEngine';
import type { PromptBuilderPort } from '../ports/PromptBuilderPort';
import type { LLMCascadePort } from '../ports/LLMCascadePort';

describe('GroundedExtractionEngine (Epistemic Schism Part A)', () => {
  const metadata: GroundedExtractionInput['metadata'] = {
    title: 'Test Lecture',
    speakerCount: 1,
    durationSeconds: 120,
    classification: 'S1',
  };

  const mockPromptBuilder: PromptBuilderPort = {
    build: vi.fn(),
    buildSegmented: vi.fn(),
    buildGroundedExtractionPrompt: vi.fn().mockReturnValue({
      systemPrompt: 'You are a sterile extraction engine. Your universe consists ONLY of the provided transcript...',
      userPrompt: 'Extract claims...',
    }),
    buildProjectiveSynthesisPrompt: vi.fn().mockReturnValue({
      systemPrompt: 'You are a projective synthesis engine...',
      userPrompt: 'Synthesize projections...',
    }),
  };

  const createMockCascade = (streamOutput: string): LLMCascadePort => ({
    generateStream: vi.fn().mockResolvedValue(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(streamOutput));
          controller.close();
        },
      }),
    ),
  } as unknown as LLMCascadePort);

  it('correctly parses sterile JSON extraction output', async () => {
    const jsonOutput = JSON.stringify({
      claims: [
        {
          id: 'claim_01',
          speaker: 'Instructor',
          timestampRange: [10.5, 25.0],
          verbatimQuote: 'Rust provides memory safety without garbage collection.',
          atomicAssertion: 'Rust ensures memory safety without GC.',
          confidence: 0.99,
        },
      ],
      unknowns: ['dimension_08_funding_sources'],
      metadata: {
        speakerCount: 1,
        durationSeconds: 120,
        classification: 'S1',
      },
    });

    const mockCascade = createMockCascade(jsonOutput);
    const engine = new GroundedExtractionEngine(mockPromptBuilder, mockCascade);

    const flushFn = vi.fn().mockResolvedValue(true);
    const waitUntil = vi.fn();

    const result = await engine.extractGroundedClaims({
      analysisId: 'analysis-101',
      videoId: 'vid-rust-01',
      transcriptChunks: [{ text: 'Rust provides memory safety...', start: 10.5, end: 25.0 }],
      metadata,
      flushPartialGhostRow: flushFn,
      waitUntil,
    });

    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.id).toBe('claim_01');
    expect(result.claims[0]?.atomicAssertion).toBe('Rust ensures memory safety without GC.');
    expect(result.unknowns).toContain('dimension_08_funding_sources');

    // Confirm ghost row flush was scheduled via waitUntil non-blockingly
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(flushFn).toHaveBeenCalledWith(result);
  });

  it('strips markdown code blocks from LLM output', () => {
    const rawFenced = `\`\`\`json
{
  "claims": [
    {
      "id": "claim_02",
      "timestampRange": [0, 5],
      "verbatimQuote": "Hello world",
      "atomicAssertion": "Speaker greets world",
      "confidence": 1.0
    }
  ],
  "unknowns": [],
  "metadata": {
    "speakerCount": 1,
    "durationSeconds": 60,
    "classification": "S1"
  }
}
\`\`\``;

    const payload = GroundedExtractionEngine.parseAndValidate(rawFenced, metadata);
    expect(payload.claims).toHaveLength(1);
    expect(payload.claims[0]?.id).toBe('claim_02');
  });

  it('throws GroundedExtractionError on invalid JSON', () => {
    expect(() => GroundedExtractionEngine.parseAndValidate('not valid json', metadata)).toThrow(
      GroundedExtractionError,
    );
  });

  it('guarantees ghost row flush does NOT throw or block extraction if flush fails', async () => {
    const jsonOutput = JSON.stringify({
      claims: [],
      unknowns: ['all'],
      metadata,
    });

    const mockCascade = createMockCascade(jsonOutput);
    const engine = new GroundedExtractionEngine(mockPromptBuilder, mockCascade);

    // flush fails with rejected promise
    const failingFlush = vi.fn().mockRejectedValue(new Error('Postgres ghost row write error'));

    const result = await engine.extractGroundedClaims({
      analysisId: 'analysis-err',
      videoId: 'vid-err',
      transcriptChunks: [],
      metadata,
      flushPartialGhostRow: failingFlush,
    });

    expect(result.unknowns).toContain('all');
  });
});
