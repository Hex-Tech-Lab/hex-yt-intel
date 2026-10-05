import { describe, it, expect, vi } from 'vitest';
import {
  ProjectiveSynthesisEngine,
  type ProjectiveSynthesisInput,
} from '../services/ProjectiveSynthesisEngine';
import type { PromptBuilderPort } from '../ports/PromptBuilderPort';
import type { LLMCascadePort } from '../ports/LLMCascadePort';
import type { GroundedExtractionPayload } from '../types/grounded-extraction';

describe('ProjectiveSynthesisEngine (Epistemic Schism Part B)', () => {
  const groundedPayload: GroundedExtractionPayload = {
    claims: [
      {
        id: 'claim_01',
        timestampRange: [10, 20],
        verbatimQuote: 'Deepgram Nova-2 achieves lowest word-error-rate at 1/3 cost.',
        atomicAssertion: 'Nova-2 has lowest WER and lower cost.',
        confidence: 0.99,
      },
      {
        id: 'claim_02',
        timestampRange: [30, 45],
        verbatimQuote: 'We migrated our real-time stack from Whisper to Nova-2 in 2 days.',
        atomicAssertion: 'Migration completed in 2 days.',
        confidence: 0.98,
      },
    ],
    unknowns: ['pricing_for_tier3'],
    metadata: {
      speakerCount: 1,
      durationSeconds: 60,
      classification: 'S1',
    },
  };

  const mockPromptBuilder: PromptBuilderPort = {
    build: vi.fn(),
    buildSegmented: vi.fn(),
    buildGroundedExtractionPrompt: vi.fn(),
    buildProjectiveSynthesisPrompt: vi.fn().mockReturnValue({
      systemPrompt: 'You are a strategic intelligence analyst...',
      userPrompt: 'Grounded Claims Payload...',
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

  it('correctly parses synthesis output and filters citations to valid claim IDs', async () => {
    const jsonOutput = JSON.stringify({
      schemaVersion: '2.0',
      persona: 'investor',
      synthesis: {
        coreThesis: 'Deepgram is displacing incumbent speech-to-text APIs rapidly [claim_01].',
        projections: [
          {
            id: 'proj_01',
            citedClaimIds: ['claim_01', 'claim_invented_99'], // 'claim_invented_99' must be filtered out
            implication: 'API providers without specialized ASIC hardware will face margin compression.',
            marketHorizon: 'near-term',
            confidence: 0.95,
          },
        ],
        unsupportedQuestions: ['Enterprise SLA terms'],
      },
    });

    const mockCascade = createMockCascade(jsonOutput);
    const engine = new ProjectiveSynthesisEngine(mockPromptBuilder, mockCascade);

    const result = await engine.synthesizeProjections({
      analysisId: 'analysis-202',
      videoId: 'vid-nova-02',
      groundedPayload,
      persona: 'investor',
    });

    expect(result.schemaVersion).toBe('2.0');
    expect(result.persona).toBe('investor');
    expect(result.synthesis.projections).toHaveLength(1);
    // Valid claim preserved, invented claim dropped
    expect(result.synthesis.projections[0]?.citedClaimIds).toEqual(['claim_01']);
    expect(result.synthesis.projections[0]?.marketHorizon).toBe('near-term');
  });

  it('rejects input if groundedPayload is missing', async () => {
    const mockCascade = createMockCascade('{}');
    const engine = new ProjectiveSynthesisEngine(mockPromptBuilder, mockCascade);

    await expect(
      engine.synthesizeProjections({
        analysisId: 'analysis-invalid',
        videoId: 'vid-invalid',
        groundedPayload: null as unknown as GroundedExtractionPayload,
      }),
    ).rejects.toThrow(/Part B synthesis requires a valid Part A GroundedExtractionPayload/);
  });
});
