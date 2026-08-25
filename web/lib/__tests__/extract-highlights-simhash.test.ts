import { describe, it, expect, vi } from 'vitest';
import { ExtractHighlightsUseCase } from '../usecases/ExtractHighlightsUseCase';
import type { HighlightsPersistencePort } from '../usecases/ExtractHighlightsUseCase';
import type { TemporalKnowledgePort } from '@/lib/ports/TemporalKnowledgePort';
import type { TextCompletionPort } from '@/lib/ports/ExecutiveDigestPorts';

describe('ExtractHighlightsUseCase - SimHash Anchors', () => {
  it('chunks 30s temporal windows and persists simhash anchors', async () => {
    const mockPersistence: HighlightsPersistencePort = {
      getTranscriptSegments: vi.fn().mockResolvedValue([
        { start: 0, text: 'Hello' },
        { start: 15, text: 'World' },
        { start: 35, text: 'Next' },
        { start: 40, text: 'Window' }
      ]),
      saveHighlights: vi.fn().mockResolvedValue(true),
      findHighlightsForAnalysis: vi.fn().mockResolvedValue([])
    };

    const mockCompletion: TextCompletionPort = {
      complete: vi.fn().mockResolvedValue({
        status: 'ok',
        text: '[{"start": 0, "end": 15, "label": "Test", "content": "test", "takeawayIdx": 0}]' // empty highlights array from LLM for simplicity
      })
    };

    const mockTemporalGraph: TemporalKnowledgePort = {
      storeSimHashAnchors: vi.fn().mockResolvedValue(true),
      queryTemporalSubgraph: vi.fn().mockResolvedValue([]),
      resolveAnchorByHammingDistance: vi.fn().mockResolvedValue(null)
    };

    const useCase = new ExtractHighlightsUseCase(mockPersistence, mockCompletion, mockTemporalGraph);

    await useCase.execute({
      analysisId: 'ana-123',
      videoId: 'vid-123',
      models: [{ id: 'model-a', modelString: 'm', provider: 'p' }]
    });

    // Expect storeSimHashAnchors to be called
    expect(mockTemporalGraph.storeSimHashAnchors).toHaveBeenCalledTimes(1);
    
    const callArgs = vi.mocked(mockTemporalGraph.storeSimHashAnchors).mock.calls[0][0];
    expect(callArgs.analysisId).toBe('ana-123');
    expect(callArgs.anchors).toHaveLength(2); // 0-30, 30-60
    
    expect(callArgs.anchors[0].windowStart).toBe(0);
    expect(callArgs.anchors[0].windowEnd).toBe(30);
    expect(typeof callArgs.anchors[0].simhash64).toBe('bigint');
    
    expect(callArgs.anchors[1].windowStart).toBe(30);
    expect(callArgs.anchors[1].windowEnd).toBe(60);
    expect(typeof callArgs.anchors[1].simhash64).toBe('bigint');
  });
});
