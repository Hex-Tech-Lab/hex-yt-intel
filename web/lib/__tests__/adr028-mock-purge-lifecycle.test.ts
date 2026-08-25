import { describe, it, expect, vi } from 'vitest';
import { ExtractHighlightsUseCase } from '@/lib/usecases/ExtractHighlightsUseCase';
import { ProcessChatMessageUseCase } from '@/lib/usecases/ProcessChatMessageUseCase';
import type { HighlightsPersistencePort } from '@/lib/usecases/ExtractHighlightsUseCase';
import type { TemporalKnowledgePort } from '@/lib/ports/TemporalKnowledgePort';
import type { ChatPersistencePort, ModelResolutionPort, CryptographicTokenPort } from '@/lib/ports/ChatPorts';
import { KnowledgeHistoryService } from '@/lib/services/KnowledgeHistoryService';

describe('ADR 028: Mock Purge Lifecycle Simulation', () => {
  it('maintains grounded citations and temporal resolution after raw transcript purge', async () => {
    // Shared Memory State for simulation
    let savedHighlights: any[] = [];
    let savedAnchors: any[] = [];
    let rawTranscript: string | null = 'Full raw transcript text...';
    
    // ---------------------------------------------------------
    // STEP 1: Simulate Ingestion & SimHash Anchor Storage
    // ---------------------------------------------------------
    const mockPersistence: HighlightsPersistencePort = {
      getTranscriptSegments: vi.fn().mockResolvedValue([
        { start: 0, text: 'This is the start of the video.' },
        { start: 30, text: 'This is the middle.' },
        { start: 60, text: 'This is the end.' }
      ]),
      saveHighlights: vi.fn().mockImplementation(async (params) => {
        savedHighlights = params.highlights;
        return true;
      }),
      findHighlightsForAnalysis: vi.fn().mockResolvedValue([])
    };

    const mockCompletion = {
      complete: vi.fn().mockResolvedValue({
        status: 'ok',
        text: JSON.stringify([
          { start: 0, end: 15, label: 'Intro', content: 'Intro text', takeawayIdx: null },
          { start: 30, end: 45, label: 'Middle', content: 'Middle text', takeawayIdx: null }
        ])
      })
    };

    const mockTemporalGraph: TemporalKnowledgePort = {
      storeSimHashAnchors: vi.fn().mockImplementation(async (params) => {
        savedAnchors = params.anchors;
        return true;
      }),
      queryTemporalSubgraph: vi.fn().mockImplementation(async () => {
        return savedAnchors.map((a, i) => ({
          ...a,
          id: `anchor-${i}`,
          depth: 1,
          salientClaim: a.salientClaim || `Claim ${i}`
        }));
      }),
      
    };

    const extractUseCase = new ExtractHighlightsUseCase(
      mockPersistence,
      mockCompletion as any,
      mockTemporalGraph
    );

    await extractUseCase.execute({
      analysisId: 'ana-123',
      videoId: 'vid-123',
      models: [{ id: 'model-a', modelString: 'm', provider: 'p' }]
    });

    expect(savedHighlights.length).toBe(2);
    expect(savedAnchors.length).toBeGreaterThan(0);

    // ---------------------------------------------------------
    // STEP 2: Simulate ADR 012 Transcript Purge
    // ---------------------------------------------------------
    rawTranscript = null; // Transcript expired/purged

    // ---------------------------------------------------------
    // STEP 3: Assert HighlightsScrubber equivalent persistence 
    // ---------------------------------------------------------
    // The highlights are stored in analysis_highlights (savedHighlights) and remain available
    // independently of the raw transcript.
    expect(savedHighlights[0].label).toBe('Intro');

    // ---------------------------------------------------------
    // STEP 4: Assert ProcessChatMessageUseCase falls back to temporal subgraph
    // ---------------------------------------------------------
    const chatPersistence: ChatPersistencePort = {
      getConversation: vi.fn().mockResolvedValue({ id: 'conv-1', userId: 'user-1', analysisId: 'ana-123' }),
      getMessages: vi.fn().mockResolvedValue([]),
      createMessage: vi.fn().mockImplementation(async (params) => ({ id: 'msg-1', ...params })),
      getAnalysisGrounding: vi.fn().mockImplementation(async () => ({
        status: 'completed',
        title: 'Test Video',
        analysisMarkdown: 'Markdown analysis',
        transcript: rawTranscript // Null!
      })),
      verifyChatOwnership: vi.fn(),
      incrementMessageCount: vi.fn(),
      findAssistantByParentId: vi.fn()
    };

    const modelResolution: ModelResolutionPort = {
      resolveModels: vi.fn().mockResolvedValue([{ id: 'model-a', modelString: 'm', provider: 'p' }]),
      resolveTierOptions: vi.fn().mockResolvedValue({ tier: 'FREE' })
    };

    const tokenCrypto: CryptographicTokenPort = {
      signChatToken: vi.fn().mockResolvedValue({ sig: 'token', exp: 12345 })
    };

    const knowledgeHistory = new KnowledgeHistoryService({
      getUserWiki: vi.fn().mockResolvedValue([])
    });

    const chatUseCase = new ProcessChatMessageUseCase(
      chatPersistence,
      modelResolution,
      tokenCrypto,
      knowledgeHistory,
      mockTemporalGraph
    );

    await chatUseCase.execute({
      conversationId: 'conv-1',
      userId: 'user-1',
      tier: 'FREE',
      content: 'What did the video say in the intro?'
    });

    // The chat usecase must have queried the temporal graph as a fallback
    expect(mockTemporalGraph.queryTemporalSubgraph).toHaveBeenCalledWith({ analysisId: 'ana-123' });
    
    // Ensures token generator creates a stream message without throwing errors
    expect(tokenCrypto.signChatToken).toHaveBeenCalled();
  });
});
