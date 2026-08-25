const fs = require('fs');
let file = fs.readFileSync('web/lib/__tests__/process-chat-temporal-grounding.test.ts', 'utf8');

const additionalTest = `
  it('retrieves semantic matching anchors by Hamming distance when query is provided', async () => {
    const chatPersistence = {
      getConversation: vi.fn().mockResolvedValue({ id: 'conv-1', userId: 'user-1', analysisId: 'ana-123' }),
      getMessages: vi.fn().mockResolvedValue([]),
      createMessage: vi.fn().mockImplementation((params) => Promise.resolve({ id: 'msg-1', ...params })),
      getAnalysisGrounding: vi.fn().mockResolvedValue({
        status: 'completed',
        title: 'Test Video',
        transcript: null
      }),
      verifyChatOwnership: vi.fn(),
      incrementMessageCount: vi.fn(),
      findAssistantByParentId: vi.fn()
    };

    const modelResolution = {
      resolveModels: vi.fn().mockResolvedValue([{ id: 'm', modelString: 'm', provider: 'p' }]),
      resolveTierOptions: vi.fn().mockResolvedValue({ tier: 'FREE' })
    };

    const tokenCrypto = {
      signChatToken: vi.fn().mockResolvedValue({ sig: 'token', exp: 12345 })
    };

    const knowledgeHistory = {
      appendInteraction: vi.fn(),
      getInteractionHistory: vi.fn().mockResolvedValue([])
    };

    const temporalGraph = {
      storeSimHashAnchors: vi.fn(),
      queryTemporalSubgraph: vi.fn().mockResolvedValue([]),
      resolveAnchorByHammingDistance: vi.fn().mockResolvedValue([
        { windowStart: 30, windowEnd: 60, simhash64: 1234n, verbatimAnchor: 'This is the exact matched anchor text.' }
      ])
    };

    const usecase = new ProcessChatMessageUseCase(
      chatPersistence as any,
      modelResolution as any,
      tokenCrypto as any,
      knowledgeHistory as any,
      temporalGraph as any
    );

    const result = await usecase.execute({
      conversationId: 'conv-1',
      userId: 'user-1',
      tier: 'FREE',
      content: 'what is the exact matched anchor text?',
      clientMsgId: 'req-1'
    });

    expect(result.type).toBe('success');
    expect(temporalGraph.resolveAnchorByHammingDistance).toHaveBeenCalledWith({
      analysisId: 'ana-123',
      queryHash: expect.any(BigInt),
      maxDistance: 12
    });
    
    // Check that the returned streaming text or grounding includes the verbatim anchor
    const call = (chatPersistence.createMessage as any).mock.calls.find((c: any) => c[0].role === 'user');
    expect(call[0].content).toContain('This is the exact matched anchor text.');
    expect(call[0].content).toContain('TEMPORAL GRAPH (Semantic Matches)');
  });
`;

file = file.replace(/describe\('ProcessChatMessageUseCase - Temporal Grounding', \(\) => \{/, "describe('ProcessChatMessageUseCase - Temporal Grounding', () => {\n" + additionalTest);

file = file.replace(/signChatToken:\s*vi\.fn\(\)\.mockResolvedValue\('token'\)/g, "signChatToken: vi.fn().mockResolvedValue({ sig: 'token', exp: 12345 })");

fs.writeFileSync('web/lib/__tests__/process-chat-temporal-grounding.test.ts', file);
