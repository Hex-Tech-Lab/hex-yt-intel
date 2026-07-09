/**
 * Chat knowledge history injection tests.
 * Verify that user's Q/A history is correctly loaded from wiki and injected into grounding context.
 *
 * Scenarios:
 * 1. Happy path: user with history injects themes and FAQs into grounding
 * 2. Edge case: user with no history (empty context, grounding unchanged)
 * 3. Edge case: history irrelevant to current question (themes shown but no matching FAQs)
 * 4. Temporal validation: Same query 1h apart with different history = different groundings
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessChatMessageUseCase } from '@/lib/usecases/ProcessChatMessageUseCase';
import { KnowledgeHistoryService } from '@/lib/services/KnowledgeHistoryService';
import { buildGroundingWithHistory } from '@/lib/utils/build-grounding-with-history';
import { EMPTY_KNOWLEDGE_CONTEXT } from '@/lib/types/knowledge-context';
import type { UserKnowledgeContext } from '@/lib/types/knowledge-context';

// ============================================================================
// Test: buildGroundingWithHistory utility
// ============================================================================

describe('buildGroundingWithHistory', () => {
  const baseGrounding = 'You are the analyst for the YouTube video "My Video". Answer questions using the analysis.';

  it('returns original grounding unchanged when knowledge context is empty', () => {
    const result = buildGroundingWithHistory(baseGrounding, EMPTY_KNOWLEDGE_CONTEXT, 'what is this video about');
    expect(result).toBe(baseGrounding);
  });

  it('injects themes into grounding when history present', () => {
    const context: UserKnowledgeContext = {
      themes: ['Python', 'Machine Learning'],
      faqs: [],
      learningSummary: 'You have asked 5 questions',
    };
    const result = buildGroundingWithHistory(baseGrounding, context, 'explain python');
    expect(result).toContain('Previously asked about: Python, Machine Learning');
  });

  it('injects FAQ items into grounding with truncated answers', () => {
    const longAnswer = 'This is a very long answer that will be truncated to stay within token budget ' + 'x'.repeat(100);
    const context: UserKnowledgeContext = {
      themes: ['Python'],
      faqs: [
        {
          theme: 'Python',
          question: 'What is a list',
          answer: longAnswer,
          relevanceScore: 2,
        },
      ],
      learningSummary: '',
    };
    const result = buildGroundingWithHistory(baseGrounding, context);
    expect(result).toContain('Previously answered:');
    expect(result).toContain('What is a list');
    // Verify truncation (80 char limit + ellipsis)
    expect(result).toContain('…');
  });

  it('selects relevant FAQs based on keyword overlap with current message', () => {
    const context: UserKnowledgeContext = {
      themes: ['Python', 'JavaScript'],
      faqs: [
        {
          theme: 'Python',
          question: 'How do I write a Python function',
          answer: 'Use the def keyword',
          relevanceScore: 2,
        },
        {
          theme: 'JavaScript',
          question: 'What is a JavaScript callback',
          answer: 'A function passed to another function',
          relevanceScore: 3,
        },
      ],
      learningSummary: '',
    };
    // Message contains "python" — should rank Python FAQ higher
    const result = buildGroundingWithHistory(baseGrounding, context, 'how do I write python code');
    expect(result).toContain('Python function');
  });

  it('keeps output bounded within token budget (~500 chars for history)', () => {
    const context: UserKnowledgeContext = {
      themes: ['A', 'B', 'C', 'D', 'E'],
      faqs: Array(20).fill(null).map((_, i) => ({
        theme: 'Theme' + i,
        question: 'Question ' + i,
        answer: 'This is answer ' + i,
        relevanceScore: 1,
      })),
      learningSummary: '',
    };
    const result = buildGroundingWithHistory(baseGrounding, context);
    // History section should not explode the grounding string excessively
    const historySection = result.slice(baseGrounding.length);
    expect(historySection.length).toBeLessThan(600);
  });
});

// ============================================================================
// Test: KnowledgeHistoryService
// ============================================================================

describe('KnowledgeHistoryService', () => {
  const mockWikiPort = {
    getUserWiki: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns EMPTY_KNOWLEDGE_CONTEXT when user has no wiki entries', async () => {
    mockWikiPort.getUserWiki.mockResolvedValue([]);
    const service = new KnowledgeHistoryService(mockWikiPort);
    const context = await service.loadUserKnowledgeContext('user-1');
    expect(context).toEqual(EMPTY_KNOWLEDGE_CONTEXT);
  });

  it('extracts top themes ranked by frequency', async () => {
    mockWikiPort.getUserWiki.mockResolvedValue([
      { userId: 'user-1', videoId: 'v1', theme: 'Python', question: 'Q1', answer: 'A1' },
      { userId: 'user-1', videoId: 'v1', theme: 'Python', question: 'Q2', answer: 'A2' },
      { userId: 'user-1', videoId: 'v2', theme: 'Python', question: 'Q3', answer: 'A3' },
      { userId: 'user-1', videoId: 'v2', theme: 'JavaScript', question: 'Q4', answer: 'A4' },
      { userId: 'user-1', videoId: 'v3', theme: 'Machine Learning', question: 'Q5', answer: 'A5' },
    ]);
    const service = new KnowledgeHistoryService(mockWikiPort);
    const context = await service.loadUserKnowledgeContext('user-1');

    expect(context.themes).toContain('Python');
    expect(context.themes[0]).toBe('Python'); // Most frequent theme should be first
    expect(context.themes.length).toBeLessThanOrEqual(5);
  });

  it('extracts FAQ items per theme ranked by relevance', async () => {
    mockWikiPort.getUserWiki.mockResolvedValue([
      { userId: 'user-1', videoId: 'v1', theme: 'Python', question: 'What is a list', answer: 'A collection', frequency: 3 },
      { userId: 'user-1', videoId: 'v1', theme: 'Python', question: 'What is a dict', answer: 'Key-value pairs', frequency: 1 },
    ]);
    const service = new KnowledgeHistoryService(mockWikiPort);
    const context = await service.loadUserKnowledgeContext('user-1');

    expect(context.faqs.length).toBeGreaterThan(0);
    expect(context.faqs[0].question).toBe('What is a list'); // Highest frequency first
  });

  it('builds learning summary with video count and question count', async () => {
    mockWikiPort.getUserWiki.mockResolvedValue([
      { userId: 'user-1', videoId: 'v1', theme: 'Python', question: 'Q1', answer: 'A1' },
      { userId: 'user-1', videoId: 'v1', theme: 'Python', question: 'Q2', answer: 'A2' },
      { userId: 'user-1', videoId: 'v2', theme: 'JavaScript', question: 'Q3', answer: 'A3' },
    ]);
    const service = new KnowledgeHistoryService(mockWikiPort);
    const context = await service.loadUserKnowledgeContext('user-1');

    expect(context.learningSummary).toContain('2 videos');
    expect(context.learningSummary).toContain('3 questions');
  });

  it('skips malformed rows (missing question or answer)', async () => {
    mockWikiPort.getUserWiki.mockResolvedValue([
      { userId: 'user-1', videoId: 'v1', theme: 'Python', question: 'Q1', answer: 'A1' },
      { userId: 'user-1', videoId: 'v1', theme: 'Python', question: '', answer: 'A2' }, // Missing question
      { userId: 'user-1', videoId: 'v1', theme: 'Python', question: 'Q3', answer: '' }, // Missing answer
    ]);
    const service = new KnowledgeHistoryService(mockWikiPort);
    const context = await service.loadUserKnowledgeContext('user-1');

    // Only valid row should be counted
    expect(context.faqs.length).toBe(1);
    expect(context.learningSummary).toContain('1 questions');
  });

  it('handles wiki fetch errors gracefully and returns empty context', async () => {
    mockWikiPort.getUserWiki.mockRejectedValue(new Error('Database error'));
    const service = new KnowledgeHistoryService(mockWikiPort);
    const context = await service.loadUserKnowledgeContext('user-1');

    expect(context).toEqual(EMPTY_KNOWLEDGE_CONTEXT);
  });

  it('limits themes to top 5 regardless of input size', async () => {
    const wiki = Array(100)
      .fill(null)
      .map((_, i) => ({
        userId: 'user-1',
        videoId: 'v' + i,
        theme: 'Theme' + (i % 10),
        question: 'Q' + i,
        answer: 'A' + i,
      }));
    mockWikiPort.getUserWiki.mockResolvedValue(wiki);
    const service = new KnowledgeHistoryService(mockWikiPort);
    const context = await service.loadUserKnowledgeContext('user-1');

    expect(context.themes.length).toBeLessThanOrEqual(5);
  });
});

// ============================================================================
// Test: ProcessChatMessageUseCase with knowledge history integration
// ============================================================================

describe('ProcessChatMessageUseCase with knowledge history injection', () => {
  const makeDepsWith = (opts: {
    analysisId: string | null;
    grounding: any;
    wikiEntries: any[];
  }) => {

    const wikiPort = {
      getUserWiki: vi.fn(async () => opts.wikiEntries),
    };
    const knowledgeService = new KnowledgeHistoryService(wikiPort);

    const chatPersistence = {
      getConversation: vi.fn(async () => ({
        id: 'c1',
        userId: 'user-1',
        analysisId: opts.analysisId,
        title: 'New chat',
      })),
      getMessages: vi.fn(async () => []),
      createMessage: vi.fn(async (m: any) => {
        if (m.role === 'assistant') {
          // Capture the refusal flow (no stream)
          return { id: 'a1', role: m.role, content: m.content };
        }
        return { id: 'u1', role: m.role, content: m.content, clientMsgId: m.clientMsgId };
      }),
      findMessageByClientMsgId: vi.fn(async () => null),
      findAssistantByParentId: vi.fn(async () => null),
      updateConversationTitle: vi.fn(),
      getAnalysisGrounding: vi.fn(async (_p: any) => opts.grounding),
      verifyChatOwnership: vi.fn(),
    };

    const modelResolution = {
      resolveModels: vi.fn(async () => ['model-a']),
    };

    const tokenCrypto = {
      signChatToken: vi.fn(async () => ({ sig: 'deadbeef', exp: Date.now() + 60_000 })),
    };

    const useCase = new ProcessChatMessageUseCase(
      chatPersistence as any,
      modelResolution as any,
      tokenCrypto as any,
      knowledgeService
    );

    return {
      useCase,
      wikiPort,
      getChatPersistenceCalls: () => chatPersistence,
    };
  };

  it('happy path: injects user knowledge history into grounding when history exists', async () => {
    const { useCase, wikiPort: _wikiPort } = makeDepsWith({
      analysisId: 'a1',
      grounding: {
        title: 'Test Video',
        channelTitle: 'Test Channel',
        description: 'Test desc',
        analysisMarkdown: 'Test analysis content',
        status: 'done',
      },
      wikiEntries: [
        { userId: 'user-1', videoId: 'v1', theme: 'Python', question: 'How do I code', answer: 'Use Python' },
      ],
    });

    const res = await useCase.execute({
      conversationId: 'c1',
      userId: 'user-1',
      tier: 'free',
      content: 'explain Python concepts',
    });

    expect(res.type).toBe('success');
    if (res.type === 'success' && res.data.payload) {
      expect(res.data.payload.grounding).toContain('Previously asked about: Python');
    }
    expect(_wikiPort.getUserWiki).toHaveBeenCalledWith('user-1');
  });

  it('edge case: user with no history passes empty context (grounding unchanged)', async () => {
    const { useCase } = makeDepsWith({
      analysisId: 'a1',
      grounding: {
        title: 'Test Video',
        channelTitle: 'Test Channel',
        description: null,
        analysisMarkdown: 'Analysis without history',
        status: 'done',
      },
      wikiEntries: [],
    });

    const res = await useCase.execute({
      conversationId: 'c1',
      userId: 'user-1',
      tier: 'free',
      content: 'what is this video about',
    });

    expect(res.type).toBe('success');
    if (res.type === 'success' && res.data.payload) {
      // Grounding should not contain history section
      expect(res.data.payload.grounding).not.toContain('YOUR LEARNING HISTORY');
    }
  });

  it('edge case: history irrelevant to current question still shows themes', async () => {
    const { useCase } = makeDepsWith({
      analysisId: 'a1',
      grounding: {
        title: 'Test Video',
        channelTitle: null,
        description: null,
        analysisMarkdown: 'Content about philosophy',
        status: 'done',
      },
      wikiEntries: [
        { userId: 'user-1', videoId: 'v1', theme: 'Music', question: 'What is jazz', answer: 'A genre' },
        { userId: 'user-1', videoId: 'v1', theme: 'Music', question: 'What is blues', answer: 'Another genre' },
      ],
    });

    const res = await useCase.execute({
      conversationId: 'c1',
      userId: 'user-1',
      tier: 'free',
      content: 'what is the philosophical framework', // Unrelated to Music theme
    });

    expect(res.type).toBe('success');
    if (res.type === 'success' && res.data.payload) {
      // Themes should be shown even if irrelevant to current message
      expect(res.data.payload.grounding).toContain('Previously asked about: Music');
    }
  });

  it('temporal validation: same query at different times with different history generates different groundings', async () => {
    // First time: no history
    const { useCase: useCase1 } = makeDepsWith({
      analysisId: 'a1',
      grounding: {
        title: 'Test Video',
        channelTitle: null,
        description: null,
        analysisMarkdown: 'Video analysis',
        status: 'done',
      },
      wikiEntries: [],
    });

    const res1 = await useCase1.execute({
      conversationId: 'c1',
      userId: 'user-1',
      tier: 'free',
      content: 'explain this video',
    });

    const grounding1 = res1.type === 'success' && res1.data.payload ? res1.data.payload.grounding : '';

    // Second time: with history
    const { useCase: useCase2 } = makeDepsWith({
      analysisId: 'a1',
      grounding: {
        title: 'Test Video',
        channelTitle: null,
        description: null,
        analysisMarkdown: 'Video analysis',
        status: 'done',
      },
      wikiEntries: [
        { userId: 'user-1', videoId: 'v1', theme: 'Concepts', question: 'What is analysis', answer: 'Breaking down' },
      ],
    });

    const res2 = await useCase2.execute({
      conversationId: 'c1',
      userId: 'user-1',
      tier: 'free',
      content: 'explain this video',
    });

    const grounding2 = res2.type === 'success' && res2.data.payload ? res2.data.payload.grounding : '';

    // Same query but different history → different groundings
    expect(grounding2).not.toBe(grounding1);
    expect(grounding2).toContain('Previously asked about: Concepts');
  });
});
