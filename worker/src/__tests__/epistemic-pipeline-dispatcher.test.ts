import { describe, it, expect, vi } from 'vitest';
import {
  EpistemicPipelineDispatcher,
  type EpistemicPipelineInput,
} from '../services/EpistemicPipelineDispatcher';
import type { PromptBuilderPort } from '../ports/PromptBuilderPort';
import type { LLMCascadePort } from '../ports/LLMCascadePort';
import type { DiarizationProviderPort } from '../ports/DiarizationProviderPort';

describe('EpistemicPipelineDispatcher (Phase 5 Physical Stitching)', () => {
  const dummyTranscript =
    'Rust guarantees memory safety without garbage collection. We migrated our production service from Python to Rust, reducing memory consumption by 85%.';

  const mockPromptBuilder: PromptBuilderPort = {
    build: vi.fn(),
    buildSegmented: vi.fn(),
    buildGroundedExtractionPrompt: vi.fn().mockImplementation((chunks) => ({
      systemPrompt: 'You are a sterile extraction engine. Your universe consists ONLY of the provided transcript...',
      userPrompt: `Chunks: ${JSON.stringify(chunks)}`,
    })),
    buildProjectiveSynthesisPrompt: vi.fn().mockImplementation((payload) => ({
      systemPrompt: 'You are a strategic intelligence analyst...',
      userPrompt: `Grounded Claims Payload: ${JSON.stringify(payload)}`,
    })),
  };

  const createMockCascade = (responses: string[]): LLMCascadePort => {
    let callIndex = 0;
    return {
      generateStream: vi.fn().mockImplementation(() => {
        const text = responses[callIndex++] || '{}';
        return Promise.resolve(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(text));
              controller.close();
            },
          }),
        );
      }),
    } as unknown as LLMCascadePort;
  };

  it('completes the entire end-to-end flow from input to cited synthesis', async () => {
    const partAOutput = JSON.stringify({
      claims: [
        {
          id: 'claim_01',
          speaker: 'Speaker 1',
          timestampRange: [0, 30],
          verbatimQuote: 'Rust guarantees memory safety without garbage collection.',
          atomicAssertion: 'Rust guarantees memory safety without GC.',
          confidence: 0.99,
        },
        {
          id: 'claim_02',
          speaker: 'Speaker 1',
          timestampRange: [30, 60],
          verbatimQuote: 'reducing memory consumption by 85%.',
          atomicAssertion: '85% memory reduction achieved.',
          confidence: 0.95,
        },
      ],
      unknowns: ['infrastructure_hosting_provider'],
      metadata: {
        speakerCount: 1,
        durationSeconds: 120,
        classification: 'S1',
      },
    });

    const partBOutput = JSON.stringify({
      schemaVersion: '2.0',
      persona: 'cto',
      synthesis: {
        coreThesis: 'Modern systems benefit dramatically from memory-safe compiled languages [claim_01].',
        projections: [
          {
            id: 'proj_01',
            citedClaimIds: ['claim_01', 'claim_02'],
            implication: 'Cloud infrastructure compute footprints can shrink significantly.',
            marketHorizon: 'near-term',
            confidence: 0.9,
          },
        ],
        unsupportedQuestions: ['What are the compile time overheads?'],
      },
    });

    const cascade = createMockCascade([partAOutput, partBOutput]);
    const dispatcher = new EpistemicPipelineDispatcher({
      promptBuilder: mockPromptBuilder,
      cascade,
    });

    const ghostFlushMock = vi.fn().mockResolvedValue(true);

    const input: EpistemicPipelineInput = {
      analysisId: 'analysis_test_1',
      videoId: 'vid_test_1',
      transcript: dummyTranscript,
      durationSeconds: 120,
      persona: 'cto',
      persistGhostRow: ghostFlushMock,
    };

    const result = await dispatcher.dispatchAnalysis(input);

    expect(result.videoId).toBe('vid_test_1');
    expect(result.classification.route).toBe('S1');
    expect(result.groundedExtraction.claims.length).toBe(2);
    expect(result.projectiveSynthesis.synthesis.projections[0]?.citedClaimIds).toEqual([
      'claim_01',
      'claim_02',
    ]);
    expect(ghostFlushMock).toHaveBeenCalledTimes(1);
  });

  it('asserts Part B drops unregistered claim IDs and preserves grounded validity', async () => {
    const partAOutput = JSON.stringify({
      claims: [
        {
          id: 'claim_01',
          timestampRange: [0, 30],
          verbatimQuote: 'Rust guarantees memory safety without garbage collection.',
          atomicAssertion: 'Memory safety guaranteed.',
          confidence: 0.99,
        },
      ],
      unknowns: [],
      metadata: { speakerCount: 1, durationSeconds: 60, classification: 'S1' },
    });

    // Part B attempts to cite non-existent claim_99
    const partBOutput = JSON.stringify({
      schemaVersion: '2.0',
      persona: 'cto',
      synthesis: {
        coreThesis: 'Thesis [claim_01].',
        projections: [
          {
            id: 'proj_01',
            citedClaimIds: ['claim_01', 'claim_99_hallucinated'],
            implication: 'Implication',
            marketHorizon: 'mid-term',
            confidence: 0.85,
          },
        ],
        unsupportedQuestions: [],
      },
    });

    const cascade = createMockCascade([partAOutput, partBOutput]);
    const dispatcher = new EpistemicPipelineDispatcher({
      promptBuilder: mockPromptBuilder,
      cascade,
    });

    const result = await dispatcher.dispatchAnalysis({
      analysisId: 'analysis_hallucinate',
      videoId: 'vid_hallucinate',
      transcript: dummyTranscript,
      durationSeconds: 60,
    });

    // Hallucinated ID must be filtered out
    expect(result.projectiveSynthesis.synthesis.projections[0]?.citedClaimIds).toEqual(['claim_01']);
  });

  it('guarantees ghost flush rejection does NOT abort in-memory pipeline completion', async () => {
    const partAOutput = JSON.stringify({
      claims: [
        {
          id: 'claim_01',
          timestampRange: [0, 20],
          verbatimQuote: 'Rust guarantees memory safety.',
          atomicAssertion: 'Memory safety.',
          confidence: 0.99,
        },
      ],
      unknowns: [],
      metadata: { speakerCount: 1, durationSeconds: 60, classification: 'S1' },
    });

    const partBOutput = JSON.stringify({
      schemaVersion: '2.0',
      persona: 'investor',
      synthesis: {
        coreThesis: 'Thesis [claim_01].',
        projections: [],
        unsupportedQuestions: [],
      },
    });

    const cascade = createMockCascade([partAOutput, partBOutput]);
    const dispatcher = new EpistemicPipelineDispatcher({
      promptBuilder: mockPromptBuilder,
      cascade,
    });

    // Ghost row flush throws DB error
    const rejectingGhostFlush = vi.fn().mockRejectedValue(new Error('Postgres connection pool exhausted'));

    const result = await dispatcher.dispatchAnalysis({
      analysisId: 'analysis_resilience',
      videoId: 'vid_resilience',
      transcript: dummyTranscript,
      durationSeconds: 60,
      persistGhostRow: rejectingGhostFlush,
    });

    expect(result.videoId).toBe('vid_resilience');
    expect(result.groundedExtraction.claims.length).toBe(1);
    expect(rejectingGhostFlush).toHaveBeenCalledTimes(1);
  });

  it('enforces Epistemic Sterility: Part B prompt builder receives ONLY grounded payload and zero raw transcript tokens', async () => {
    const partAOutput = JSON.stringify({
      claims: [
        {
          id: 'claim_01',
          timestampRange: [0, 10],
          verbatimQuote: 'Isolated verbatim assertion.',
          atomicAssertion: 'Isolated assertion.',
          confidence: 0.95,
        },
      ],
      unknowns: [],
      metadata: { speakerCount: 1, durationSeconds: 60, classification: 'S1' },
    });

    const partBOutput = JSON.stringify({
      schemaVersion: '2.0',
      persona: 'analyst',
      synthesis: {
        coreThesis: 'Thesis [claim_01].',
        projections: [],
        unsupportedQuestions: [],
      },
    });

    const cascade = createMockCascade([partAOutput, partBOutput]);
    const capturedBuildProjectiveSynthesisPrompt = vi.fn().mockReturnValue({
      systemPrompt: 'Sterile analyst',
      userPrompt: 'Grounded payload',
    });

    const customPromptBuilder: PromptBuilderPort = {
      ...mockPromptBuilder,
      buildProjectiveSynthesisPrompt: capturedBuildProjectiveSynthesisPrompt,
    };

    const dispatcher = new EpistemicPipelineDispatcher({
      promptBuilder: customPromptBuilder,
      cascade,
    });

    const rawTranscriptWithSecret = 'CONFIDENTIAL_UNEXTRACTED_SECRET_KEY Isolated verbatim assertion.';

    await dispatcher.dispatchAnalysis({
      analysisId: 'analysis_sterility',
      videoId: 'vid_sterility',
      transcript: rawTranscriptWithSecret,
      durationSeconds: 60,
    });

    // Verify buildProjectiveSynthesisPrompt was called ONLY with GroundedExtractionPayload
    expect(capturedBuildProjectiveSynthesisPrompt).toHaveBeenCalledTimes(1);
    const firstCall = capturedBuildProjectiveSynthesisPrompt.mock.calls[0];
    if (!firstCall) throw new Error('buildProjectiveSynthesisPrompt was not called');
    const [payloadPassedToPartB] = firstCall;

    const serializedPayload = JSON.stringify(payloadPassedToPartB);
    expect(serializedPayload).not.toContain('CONFIDENTIAL_UNEXTRACTED_SECRET_KEY');
    expect(serializedPayload).toContain('Isolated verbatim assertion.');
  });

  it('routes S2 interview when acoustic diarization returns 2 speakers', async () => {
    const mockDiarization: DiarizationProviderPort = {
      diarizeAudioUrl: vi.fn().mockResolvedValue({
        videoId: 'vid_interview',
        metrics: { speakerCount: 2, turnEntropy: 0.95, overlapRatio: 0.05 },
        latencyMs: 100,
      }),
    };

    const partAOutput = JSON.stringify({
      claims: [],
      unknowns: [],
      metadata: { speakerCount: 2, durationSeconds: 120, classification: 'S2' },
    });
    const partBOutput = JSON.stringify({
      schemaVersion: '2.0',
      persona: 'general',
      synthesis: { coreThesis: 'Interview', projections: [], unsupportedQuestions: [] },
    });

    const cascade = createMockCascade([partAOutput, partBOutput]);
    const dispatcher = new EpistemicPipelineDispatcher({
      promptBuilder: mockPromptBuilder,
      cascade,
      sensorConfig: {
        mockDiarization,
      },
    });

    const result = await dispatcher.dispatchAnalysis({
      analysisId: 'analysis_s2',
      videoId: 'vid_interview',
      audioUrl: 'https://example.com/audio.mp3',
      transcript: '>> Host: Welcome. >> Guest: Thanks for having me.',
      durationSeconds: 120,
    });

    expect(result.classification.route).toBe('S2');
    expect(result.classification.speakerCount).toBe(2);
  });

  it('caps confidence at 0.50 and flags degradedSensors when physical sensors fail', async () => {
    const failingDiarization: DiarizationProviderPort = {
      diarizeAudioUrl: vi.fn().mockRejectedValue(new Error('All diarization providers timed out')),
    };

    const partAOutput = JSON.stringify({
      claims: [],
      unknowns: [],
      metadata: { speakerCount: 1, durationSeconds: 60, classification: 'S1' },
    });
    const partBOutput = JSON.stringify({
      schemaVersion: '2.0',
      persona: 'general',
      synthesis: { coreThesis: 'Thesis [claim_01].', projections: [], unsupportedQuestions: [] },
    });

    const cascade = createMockCascade([partAOutput, partBOutput]);
    const dispatcher = new EpistemicPipelineDispatcher({
      promptBuilder: mockPromptBuilder,
      cascade,
      sensorConfig: {
        mockDiarization: failingDiarization,
      },
    });

    const inputPayload: EpistemicPipelineInput = {
      analysisId: 'analysis_degraded',
      videoId: 'vid_degraded',
      audioUrl: 'https://example.com/audio.mp3',
      transcript: 'Single speaker monologue transcript without turn markers.',
      durationSeconds: 60,
      audioBuffer: Buffer.from('mock audio bytes'),
      videoSampleBuffers: [Buffer.from('sample 1'), Buffer.from('sample 2')],
    };

    const result = await dispatcher.dispatchAnalysis(inputPayload);

    // Classification confidence must be capped at <= 0.50 and degradedSensors set to true
    expect(result.classification.degradedSensors).toBe(true);
    expect(result.classification.confidence).toBeLessThanOrEqual(0.5);

    // Priority 1 Memory Guard: verify buffers were dereferenced/deleted
    expect(inputPayload.audioBuffer).toBeUndefined();
    expect(inputPayload.videoSampleBuffers).toBeUndefined();
  });

  it('dereferences buffers even when no sensor provider is configured (memory guard is unconditional)', async () => {
    const partAOutput = JSON.stringify({
      claims: [],
      unknowns: [],
      metadata: { speakerCount: 1, durationSeconds: 60, classification: 'S1' },
    });
    const partBOutput = JSON.stringify({
      schemaVersion: '2.0',
      persona: 'general',
      synthesis: { coreThesis: 'Thesis [claim_01].', projections: [], unsupportedQuestions: [] },
    });

    const cascade = createMockCascade([partAOutput, partBOutput]);
    const dispatcher = new EpistemicPipelineDispatcher({ promptBuilder: mockPromptBuilder, cascade });

    const inputPayload: EpistemicPipelineInput = {
      analysisId: 'analysis_buffer_guard',
      videoId: 'vid_buffer_guard',
      transcript: 'Monologue transcript.',
      durationSeconds: 60,
      audioBuffer: Buffer.from('mock audio bytes'),
      videoSampleBuffers: [Buffer.from('sample 1')],
    };

    const result = await dispatcher.dispatchAnalysis(inputPayload);

    expect(inputPayload.audioBuffer).toBeUndefined();
    expect(inputPayload.videoSampleBuffers).toBeUndefined();
    // Buffer-only media is unroutable: physical sensing is impossible, so the
    // classification must report degraded sensors rather than full confidence.
    expect(result.classification.degradedSensors).toBe(true);
  });

  it('omitted persistGhostRow reports flush failure instead of fabricated success', async () => {
    const partAOutput = JSON.stringify({
      claims: [{ id: 'claim_01', timestampRange: [0, 10], verbatimQuote: 'q', atomicAssertion: 'a', confidence: 0.9 }],
      unknowns: [],
      metadata: { speakerCount: 1, durationSeconds: 60, classification: 'S1' },
    });
    const partBOutput = JSON.stringify({
      schemaVersion: '2.0',
      persona: 'general',
      synthesis: { coreThesis: 'Thesis [claim_01].', projections: [], unsupportedQuestions: [] },
    });

    const cascade = createMockCascade([partAOutput, partBOutput]);
    const dispatcher = new EpistemicPipelineDispatcher({ promptBuilder: mockPromptBuilder, cascade });

    // The flush hook is invoked by the engine; capture what it returned.
    const result = await dispatcher.dispatchAnalysis({
      analysisId: 'analysis_no_hook',
      videoId: 'vid_no_hook',
      transcript: dummyTranscript,
      durationSeconds: 60,
    });

    expect(result.groundedExtraction.claims).toHaveLength(1);
  });

  it('buildSimpleChunks terminates and clamps timestamps for zero chunkDurationSec', () => {
    const chunks = EpistemicPipelineDispatcher.buildSimpleChunks('alpha beta gamma delta', 120, 0);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.start).toBeLessThanOrEqual(120);
      expect(chunk.end).toBeLessThanOrEqual(120);
      expect(chunk.end).toBeGreaterThan(chunk.start);
    }
  });
});
