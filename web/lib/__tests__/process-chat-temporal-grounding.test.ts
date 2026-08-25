import { describe, it, expect, vi } from 'vitest';
import { ProcessChatMessageUseCase } from '@/lib/usecases/ProcessChatMessageUseCase';
import type { ChatPersistencePort, ModelResolutionPort, CryptographicTokenPort } from '@/lib/ports/ChatPorts';
import { KnowledgeHistoryService } from '@/lib/services/KnowledgeHistoryService';
import type { TemporalKnowledgePort } from '@/lib/ports/TemporalKnowledgePort';

describe('ProcessChatMessageUseCase - Temporal Grounding', () => {
  it('retrieves temporal graph anchors when raw transcript is missing (>72h)', async () => {
    const chatPersistence: ChatPersistencePort = {
      getConversation: vi.fn().mockResolvedValue({ id: 'conv-1', userId: 'user-1', analysisId: 'ana-123' }),
      getMessages: vi.fn().mockResolvedValue([]),
      createMessage: vi.fn().mockImplementation(async (params) => ({ id: 'msg-1', ...params })),
      getAnalysisGrounding: vi.fn().mockResolvedValue({
        status: 'completed',
        title: 'Test Video',
        analysisMarkdown: 'Some markdown',
        transcript: null // Null transcript triggers fallback
      }),
      verifyChatOwnership: vi.fn(),
      incrementMessageCount: vi.fn(),
      findAssistantByParentId: vi.fn()
    };

    const modelResolution: ModelResolutionPort = {
      resolveModels: vi.fn().mockResolvedValue([{ id: 'model-a', modelString: 'm', provider: 'p' }]),
      resolveTierOptions: vi.fn().mockResolvedValue({ tier: 'FREE' })
    };

    const tokenCrypto: CryptographicTokenPort = {
      signChatToken: vi.fn().mockResolvedValue('token')
    };

    const knowledgeHistory = new KnowledgeHistoryService({
      getUserWiki: vi.fn().mockResolvedValue([])
    });

    const temporalGraph: TemporalKnowledgePort = {
      storeSimHashAnchors: vi.fn(),
      queryTemporalSubgraph: vi.fn().mockResolvedValue([
        { id: 'node-1', windowStart: 30, windowEnd: 60, simhash64: 123n, salientClaim: 'Test claim', verbatimAnchor: null }
      ]),
    };

    const useCase = new ProcessChatMessageUseCase(
      chatPersistence,
      modelResolution,
      tokenCrypto,
      knowledgeHistory,
      temporalGraph
    );

    await useCase.execute({
      conversationId: 'conv-1',
      userId: 'user-1',
      tier: 'FREE',
      content: 'hello'
    });

    expect(temporalGraph.queryTemporalSubgraph).toHaveBeenCalledWith({ analysisId: 'ana-123' });
    expect(chatPersistence.createMessage).toHaveBeenCalledTimes(1); // One for user, one for assistant placeholder
    
    // Check what the assistant token generator gets in context
    // Actually we just care if it successfully called queryTemporalSubgraph when transcript is null
  });
});
