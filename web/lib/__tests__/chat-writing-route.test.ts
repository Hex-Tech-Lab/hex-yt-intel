// T21: a writing request signs and forwards the writing cascade; a question does not.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/config/cascade', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/config/cascade')>();
  return {
    ...actual,
    resolveChatCascade: vi.fn().mockResolvedValue([{ model: 'openai/gpt-oss-120b', name: 'chat', providerOrder: ['cerebras'] }]),
    resolveChatWritingCascade: vi.fn().mockResolvedValue([
      { model: 'anthropic/claude-haiku-5.5', name: 'Claude Haiku 5.5 (Vertex)', providerOrder: ['google-vertex'] },
      { model: 'anthropic/claude-haiku-5.5', name: 'Claude Haiku 5.5 (Anthropic Direct)', providerOrder: ['anthropic'] },
      { model: 'openai/gpt-oss-120b', name: 'gpt-oss-120b (Groq)', providerOrder: ['groq'] },
    ]),
  };
});

import { ProcessChatMessageUseCase } from '@/lib/usecases/ProcessChatMessageUseCase';

function build() {
  const chatPersistence = {
    getConversation: vi.fn().mockResolvedValue({ id: 'conv-1', userId: 'user-1', analysisId: 'ana-1' }),
    getMessages: vi.fn().mockResolvedValue([]),
    createMessage: vi.fn().mockImplementation((params) => Promise.resolve({ id: 'msg-1', ...params })),
    getAnalysisGrounding: vi.fn().mockResolvedValue({ status: 'completed', title: 'T', analysisMarkdown: 'Some markdown', transcript: null }),
    verifyChatOwnership: vi.fn(),
    incrementMessageCount: vi.fn(),
    findAssistantByParentId: vi.fn(),
  };
  const modelResolution = { resolveModels: vi.fn().mockResolvedValue(['openai/gpt-oss-120b']), resolveTierOptions: vi.fn() };
  const tokenCrypto = { signChatToken: vi.fn().mockResolvedValue({ sig: 's', exp: 1 }) };
  const knowledgeHistory = { appendInteraction: vi.fn(), loadUserKnowledgeContext: vi.fn().mockResolvedValue(''), getInteractionHistory: vi.fn().mockResolvedValue([]) };
  const temporalGraph = { storeSimHashAnchors: vi.fn(), queryTemporalSubgraph: vi.fn().mockResolvedValue([]), resolveAnchorByHammingDistance: vi.fn().mockResolvedValue([]) };
  const usecase = new ProcessChatMessageUseCase(chatPersistence as never, modelResolution as never, tokenCrypto as never, knowledgeHistory as never, temporalGraph as never);
  return { usecase, tokenCrypto };
}

async function run(content: string, tier = 'pro') {
  const { usecase, tokenCrypto } = build();
  const result = await usecase.execute({ conversationId: 'conv-1', userId: 'user-1', tier, content } as never);
  const payload = (result as { data?: { payload?: { models: string[]; cascade: Array<{ model: string }> } } }).data?.payload;
  return { payload, signedModels: tokenCrypto.signChatToken.mock.calls[0]?.[0]?.models };
}

describe('chat writing route (T21)', () => {
  it('a writing request uses the writing cascade for both the signed models and the forwarded cascade', async () => {
    const { payload, signedModels } = await run('Write a LinkedIn post about the main takeaway');
    expect(payload?.cascade.map((c) => c.model)).toEqual(['anthropic/claude-haiku-5.5', 'anthropic/claude-haiku-5.5', 'openai/gpt-oss-120b']);
    expect(signedModels).toEqual(['anthropic/claude-haiku-5.5', 'openai/gpt-oss-120b']);
  });

  it('writing intent wins over a reasoning keyword in the topic ("why")', async () => {
    const { payload } = await run('Write a LinkedIn post about why this video matters');
    expect(payload?.cascade[0]?.model).toBe('anthropic/claude-haiku-5.5');
  });

  it('an explicit /reason command still uses reasoning, not writing', async () => {
    const { payload } = await run('/reason write a LinkedIn post about this');
    expect(payload?.cascade.map((c) => c.model)).not.toContain('anthropic/claude-haiku-5.5');
  });

  it('free tier keeps the chat cascade even for writing (cost)', async () => {
    const { payload } = await run('Write a LinkedIn post about the main takeaway', 'free');
    expect(payload?.cascade.map((c) => c.model)).toEqual(['openai/gpt-oss-120b']);
  });

  it('a normal question keeps the chat cascade', async () => {
    const { payload } = await run('What did the speaker say about pricing?');
    expect(payload?.cascade.map((c) => c.model)).toEqual(['openai/gpt-oss-120b']);
  });
});
