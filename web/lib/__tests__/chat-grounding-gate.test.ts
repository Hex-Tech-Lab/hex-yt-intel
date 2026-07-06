/**
 * Chat grounding gate (security).
 * The chat's universe is one video's analysis. If the bound analysis has no
 * usable content, the use case must REFUSE — persist a controlled assistant
 * turn and mint NO stream token — so an ungrounded model can never answer from
 * general knowledge (or drift to a different video). With real grounding it
 * streams as normal.
 */
import { ProcessChatMessageUseCase } from '@/lib/usecases/ProcessChatMessageUseCase';

type Grounding = { title: string; channelTitle: string | null; description: string | null; analysisMarkdown: string | null; status: string } | null;

function makeDeps(opts: { analysisId: string | null; grounding: Grounding }) {
  let assistantContent: string | null = null;
  const chatPersistence = {
    getConversation: async () => ({ id: 'c1', userId: 'user-1', analysisId: opts.analysisId, title: 'New chat' }),
    getMessages: async () => [],
    createMessage: async (m: { role: string; content: string }) => {
      if (m.role === 'assistant') assistantContent = m.content;
      return { id: m.role === 'assistant' ? 'a1' : 'u1', role: m.role, content: m.content, clientMsgId: null };
    },
    findMessageByClientMsgId: async () => null,
    findAssistantByParentId: async () => null,
    updateConversationTitle: async () => undefined,
    getAnalysisGrounding: async () => opts.grounding,
  } as never;
  const modelResolution = { resolveModels: async () => ['model-a'] } as never;
  const tokenCrypto = { signChatToken: async () => ({ sig: 'deadbeef', exp: Date.now() + 60_000 }) } as never;
  return {
    useCase: new ProcessChatMessageUseCase(chatPersistence, modelResolution, tokenCrypto),
    getAssistant: () => assistantContent,
  };
}

const baseParams = { conversationId: 'c1', userId: 'user-1', tier: 'free' as const, content: 'give me the recipe', clientMsgId: null };

describe('ProcessChatMessageUseCase grounding gate', () => {
  it('refuses (no stream token) when the video has no analysis bound', async () => {
    const { useCase, getAssistant } = makeDeps({ analysisId: null, grounding: null });
    const res = await useCase.execute(baseParams);
    expect(res.type).toBe('success');
    if (res.type !== 'success') return;
    expect(res.data.stream).toBeUndefined();
    expect(res.data.payload).toBeUndefined();
    expect(res.data.assistant).toBeDefined();
    expect(getAssistant()).toMatch(/no transcript|captions|can only answer/i);
  });

  it('refuses when the bound analysis has empty markdown (no-transcript / failed)', async () => {
    const { useCase } = makeDeps({
      analysisId: 'an-1',
      grounding: { title: 'Cake Short', channelTitle: 'foodzizzles', description: null, analysisMarkdown: '', status: 'failed' },
    });
    const res = await useCase.execute(baseParams);
    if (res.type !== 'success') throw new Error('expected success');
    expect(res.data.stream).toBeUndefined();
    expect(res.data.assistant?.content).toMatch(/can only answer|no transcript|captions/i);
  });

  it('gives a "still generating" refusal while the analysis is processing', async () => {
    const { useCase } = makeDeps({
      analysisId: 'an-1',
      grounding: { title: 'X', channelTitle: null, description: null, analysisMarkdown: '   ', status: 'processing' },
    });
    const res = await useCase.execute(baseParams);
    if (res.type !== 'success') throw new Error('expected success');
    expect(res.data.stream).toBeUndefined();
    expect(res.data.assistant?.content).toMatch(/still being generated|once the synthesis/i);
  });

  it('streams (mints token + grounding) when real analysis content exists', async () => {
    const { useCase } = makeDeps({
      analysisId: 'an-1',
      grounding: {
        title: 'Real Video',
        channelTitle: 'Chan',
        description: 'desc',
        analysisMarkdown: '### DIMENSION 1\nSubstantive analysis content here.',
        status: 'complete',
      },
    });
    const res = await useCase.execute(baseParams);
    if (res.type !== 'success') throw new Error('expected success');
    expect(res.data.stream).toBeDefined();
    expect(res.data.payload).toBeDefined();
    expect(res.data.payload?.grounding).toContain('Real Video');
    expect(res.data.payload?.grounding).toContain('Substantive analysis content');
  });
});
