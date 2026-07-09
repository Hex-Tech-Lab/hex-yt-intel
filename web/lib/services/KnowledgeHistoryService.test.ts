/**
 * Comprehensive tests for KnowledgeHistoryService
 *
 * Test Coverage:
 * 1. FAQ extraction from wiki markdown is meaningful (not placeholder)
 * 2. No-history and sparse-history edge cases
 * 3. Malformed wiki rows handling
 * 4. Learning summary accuracy
 * 5. Data integrity across the pipeline
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KnowledgeHistoryService, type KnowledgeWikiPort } from './KnowledgeHistoryService';
import { EMPTY_KNOWLEDGE_CONTEXT } from '@/lib/types/knowledge-context';

describe('KnowledgeHistoryService Data Correctness Tests', () => {
  let mockWikiPort: KnowledgeWikiPort;
  let service: KnowledgeHistoryService;

  beforeEach(() => {
    mockWikiPort = {
      getUserWiki: vi.fn(),
    };
    service = new KnowledgeHistoryService(mockWikiPort);
  });

  describe('[No History] Edge case when user has no wiki data', () => {
    it('should return EMPTY_KNOWLEDGE_CONTEXT when wiki is empty', async () => {
      vi.mocked(mockWikiPort.getUserWiki).mockResolvedValueOnce([]);

      const context = await service.loadUserKnowledgeContext('user-1');

      expect(context).toEqual(EMPTY_KNOWLEDGE_CONTEXT);
      expect(context.themes).toHaveLength(0);
      expect(context.faqs).toHaveLength(0);
      expect(context.learningSummary).toBe('');
    });

    it('should return EMPTY_KNOWLEDGE_CONTEXT when wiki is null', async () => {
      vi.mocked(mockWikiPort.getUserWiki).mockResolvedValueOnce(null as any);

      const context = await service.loadUserKnowledgeContext('user-1');

      expect(context).toEqual(EMPTY_KNOWLEDGE_CONTEXT);
    });

    it('should handle wiki port errors gracefully', async () => {
      vi.mocked(mockWikiPort.getUserWiki).mockRejectedValueOnce(new Error('Database connection failed'));

      const context = await service.loadUserKnowledgeContext('user-1');

      expect(context).toEqual(EMPTY_KNOWLEDGE_CONTEXT);
    });
  });

  describe('[Sparse History] Edge case with very limited wiki data', () => {
    it('should handle single wiki entry', async () => {
      const mockWiki = [
        {
          id: 'wiki-1',
          user_id: 'user-1',
          topic: 'Python',
          wiki_markdown: `# May 2026 Knowledge Wiki
## Python
**Questions in this theme:** 1

### FAQ
- How do I write a Python function?

### Common Keywords
python, function`,
          question_count: 1,
          theme_count: 1,
          created_at: '2026-07-08T00:00:00Z',
          updated_at: '2026-07-08T00:00:00Z',
        },
      ];
      vi.mocked(mockWikiPort.getUserWiki).mockResolvedValueOnce(mockWiki);

      const context = await service.loadUserKnowledgeContext('user-1');

      expect(context.themes).toContain('Python');
      expect(context.faqs.length).toBeGreaterThan(0);
      expect(context.learningSummary).toContain('Python');
      expect(context.learningSummary).toContain('1 questions');
    });

    it('should extract questions from wiki markdown when present', async () => {
      const mockWiki = [
        {
          id: 'wiki-1',
          user_id: 'user-1',
          topic: 'Security',
          wiki_markdown: `# June 2026 Knowledge Wiki
## Security
**Questions in this theme:** 2

### FAQ
- What is encryption?
- How do I secure passwords?

### Common Keywords
encryption, security, password`,
          question_count: 2,
          theme_count: 1,
          created_at: '2026-07-08T00:00:00Z',
          updated_at: '2026-07-08T00:00:00Z',
        },
      ];
      vi.mocked(mockWikiPort.getUserWiki).mockResolvedValueOnce(mockWiki);

      const context = await service.loadUserKnowledgeContext('user-1');

      // Should extract real questions from markdown, not just use topic name
      expect(context.faqs.length).toBeGreaterThan(0);
      expect(context.faqs[0].question).not.toBe('Security'); // Not just the topic name
      expect(context.faqs[0].question).toContain('encryption');
    });

    it('should fallback to theme name when markdown has no FAQs', async () => {
      const mockWiki = [
        {
          id: 'wiki-1',
          user_id: 'user-1',
          topic: 'Python',
          wiki_markdown: `# May 2026 Knowledge Wiki
## Python
**Questions in this theme:** 1

### Common Keywords
python`,
          question_count: 1,
          theme_count: 1,
          created_at: '2026-07-08T00:00:00Z',
          updated_at: '2026-07-08T00:00:00Z',
        },
      ];
      vi.mocked(mockWikiPort.getUserWiki).mockResolvedValueOnce(mockWiki);

      const context = await service.loadUserKnowledgeContext('user-1');

      // Should still return context with theme, just may have fewer FAQs
      expect(context.themes).toContain('Python');
    });
  });

  describe('[Malformed Rows] Handling of invalid wiki data', () => {
    it('should skip wiki entries with empty topic', async () => {
      const mockWiki = [
        {
          id: 'wiki-1',
          user_id: 'user-1',
          topic: '',
          wiki_markdown: 'Some content',
          question_count: 1,
          theme_count: 1,
          created_at: '2026-07-08T00:00:00Z',
          updated_at: '2026-07-08T00:00:00Z',
        },
        {
          id: 'wiki-2',
          user_id: 'user-1',
          topic: 'Python',
          wiki_markdown: 'Python content',
          question_count: 2,
          theme_count: 1,
          created_at: '2026-07-08T00:00:00Z',
          updated_at: '2026-07-08T00:00:00Z',
        },
      ];
      vi.mocked(mockWikiPort.getUserWiki).mockResolvedValueOnce(mockWiki);

      const context = await service.loadUserKnowledgeContext('user-1');

      // Should only include valid entry
      expect(context.themes).toContain('Python');
      expect(context.themes).not.toContain('');
    });

    it('should handle wiki entries with whitespace-only topic', async () => {
      const mockWiki = [
        {
          id: 'wiki-1',
          user_id: 'user-1',
          topic: '   ',
          wiki_markdown: 'Content',
          question_count: 1,
          theme_count: 1,
          created_at: '2026-07-08T00:00:00Z',
          updated_at: '2026-07-08T00:00:00Z',
        },
      ];
      vi.mocked(mockWikiPort.getUserWiki).mockResolvedValueOnce(mockWiki);

      const context = await service.loadUserKnowledgeContext('user-1');

      // Empty/whitespace topics should be treated as empty
      expect(context.themes.length).toBe(0);
    });

    it('should handle missing question_count field', async () => {
      const mockWiki = [
        {
          id: 'wiki-1',
          user_id: 'user-1',
          topic: 'Python',
          wiki_markdown: 'Python content',
          question_count: undefined as any,
          theme_count: 1,
          created_at: '2026-07-08T00:00:00Z',
          updated_at: '2026-07-08T00:00:00Z',
        },
      ];
      vi.mocked(mockWikiPort.getUserWiki).mockResolvedValueOnce(mockWiki);

      const context = await service.loadUserKnowledgeContext('user-1');

      // Should handle gracefully, using default value (1)
      expect(context.themes).toContain('Python');
    });

    it('should handle malformed wiki_markdown gracefully', async () => {
      const mockWiki = [
        {
          id: 'wiki-1',
          user_id: 'user-1',
          topic: 'Python',
          wiki_markdown: 'Not proper markdown format at all [[[ }}}',
          question_count: 1,
          theme_count: 1,
          created_at: '2026-07-08T00:00:00Z',
          updated_at: '2026-07-08T00:00:00Z',
        },
      ];
      vi.mocked(mockWikiPort.getUserWiki).mockResolvedValueOnce(mockWiki);

      const context = await service.loadUserKnowledgeContext('user-1');

      // Should not crash, but may have fewer FAQs
      expect(context.themes).toContain('Python');
      expect(context).toBeDefined();
    });

    it('should handle null wiki_markdown', async () => {
      const mockWiki = [
        {
          id: 'wiki-1',
          user_id: 'user-1',
          topic: 'Python',
          wiki_markdown: null as any,
          question_count: 1,
          theme_count: 1,
          created_at: '2026-07-08T00:00:00Z',
          updated_at: '2026-07-08T00:00:00Z',
        },
      ];
      vi.mocked(mockWikiPort.getUserWiki).mockResolvedValueOnce(mockWiki);

      const context = await service.loadUserKnowledgeContext('user-1');

      // Should handle gracefully
      expect(context.themes).toContain('Python');
    });
  });

  describe('[FAQ Extraction] Meaningful FAQ parsing from markdown', () => {
    it('should extract real questions from markdown FAQ section', async () => {
      const mockWiki = [
        {
          id: 'wiki-1',
          user_id: 'user-1',
          topic: 'JavaScript',
          wiki_markdown: `# July 2026 Knowledge Wiki
## JavaScript
**Questions in this theme:** 3

### FAQ
- What is a closure?
- How do I use arrow functions?
- Why is callback hell a problem?

### Common Keywords
javascript, function, callback`,
          question_count: 3,
          theme_count: 1,
          created_at: '2026-07-08T00:00:00Z',
          updated_at: '2026-07-08T00:00:00Z',
        },
      ];
      vi.mocked(mockWikiPort.getUserWiki).mockResolvedValueOnce(mockWiki);

      const context = await service.loadUserKnowledgeContext('user-1');

      // Should extract real questions
      expect(context.faqs.length).toBeGreaterThan(0);
      expect(context.faqs.some((faq) => faq.question.includes('closure'))).toBe(true);
      expect(context.faqs.some((faq) => faq.question.includes('arrow'))).toBe(true);
    });

    it('should truncate very long questions to 200 chars', async () => {
      const longQuestion = 'A'.repeat(300);
      const mockWiki = [
        {
          id: 'wiki-1',
          user_id: 'user-1',
          topic: 'Test',
          wiki_markdown: `# July 2026 Knowledge Wiki
## Test
**Questions in this theme:** 1

### FAQ
- ${longQuestion}

### Common Keywords
test`,
          question_count: 1,
          theme_count: 1,
          created_at: '2026-07-08T00:00:00Z',
          updated_at: '2026-07-08T00:00:00Z',
        },
      ];
      vi.mocked(mockWikiPort.getUserWiki).mockResolvedValueOnce(mockWiki);

      const context = await service.loadUserKnowledgeContext('user-1');

      // Should truncate
      expect(context.faqs[0].question.length).toBeLessThanOrEqual(203); // 200 + "..."
    });

    it('should extract questions from multiple theme sections', async () => {
      const mockWiki = [
        {
          id: 'wiki-1',
          user_id: 'user-1',
          topic: 'Python',
          wiki_markdown: `# July 2026 Knowledge Wiki
## Python
**Questions in this theme:** 2

### FAQ
- How do I use list comprehension?
- What is a generator?

### Common Keywords
python`,
          question_count: 2,
          theme_count: 1,
          created_at: '2026-07-08T00:00:00Z',
          updated_at: '2026-07-08T00:00:00Z',
        },
        {
          id: 'wiki-2',
          user_id: 'user-1',
          topic: 'JavaScript',
          wiki_markdown: `# July 2026 Knowledge Wiki
## JavaScript
**Questions in this theme:** 1

### FAQ
- What is event bubbling?

### Common Keywords
javascript`,
          question_count: 1,
          theme_count: 1,
          created_at: '2026-07-08T00:00:00Z',
          updated_at: '2026-07-08T00:00:00Z',
        },
      ];
      vi.mocked(mockWikiPort.getUserWiki).mockResolvedValueOnce(mockWiki);

      const context = await service.loadUserKnowledgeContext('user-1');

      // Should extract from both themes
      expect(context.faqs.length).toBeGreaterThan(0);
      expect(context.faqs.some((faq) => faq.question.includes('list comprehension'))).toBe(true);
      expect(context.faqs.some((faq) => faq.question.includes('event bubbling'))).toBe(true);
    });

    it('should rank FAQs by relevanceScore (question_count)', async () => {
      const mockWiki = [
        {
          id: 'wiki-1',
          user_id: 'user-1',
          topic: 'Python',
          wiki_markdown: `# July 2026 Knowledge Wiki
## Python
**Questions in this theme:** 5

### FAQ
- High relevance question

### Common Keywords
python`,
          question_count: 5,
          theme_count: 1,
          created_at: '2026-07-08T00:00:00Z',
          updated_at: '2026-07-08T00:00:00Z',
        },
        {
          id: 'wiki-2',
          user_id: 'user-1',
          topic: 'Ruby',
          wiki_markdown: `# July 2026 Knowledge Wiki
## Ruby
**Questions in this theme:** 1

### FAQ
- Low relevance question

### Common Keywords
ruby`,
          question_count: 1,
          theme_count: 1,
          created_at: '2026-07-08T00:00:00Z',
          updated_at: '2026-07-08T00:00:00Z',
        },
      ];
      vi.mocked(mockWikiPort.getUserWiki).mockResolvedValueOnce(mockWiki);

      const context = await service.loadUserKnowledgeContext('user-1');

      // Higher question count should be ranked first
      if (context.faqs.length > 1) {
        expect(context.faqs[0].relevanceScore).toBeGreaterThanOrEqual(
          context.faqs[context.faqs.length - 1].relevanceScore || 0
        );
      }
    });

    it('should limit total FAQs to 5', async () => {
      const mockWiki = Array.from({ length: 10 }, (_, i) => ({
        id: `wiki-${i}`,
        user_id: 'user-1',
        topic: `Theme${i}`,
        wiki_markdown: `# July 2026 Knowledge Wiki
## Theme${i}
**Questions in this theme:** ${i + 1}

### FAQ
- Question from theme ${i}

### Common Keywords
theme`,
        question_count: i + 1,
        theme_count: 1,
        created_at: '2026-07-08T00:00:00Z',
        updated_at: '2026-07-08T00:00:00Z',
      }));
      vi.mocked(mockWikiPort.getUserWiki).mockResolvedValueOnce(mockWiki);

      const context = await service.loadUserKnowledgeContext('user-1');

      expect(context.faqs.length).toBeLessThanOrEqual(5);
    });
  });

  describe('[Theme Extraction] Learning summary accuracy', () => {
    it('should include top 5 themes in learning summary', async () => {
      const mockWiki = Array.from({ length: 7 }, (_, i) => ({
        id: `wiki-${i}`,
        user_id: 'user-1',
        topic: `Theme${i}`,
        wiki_markdown: 'Content',
        question_count: 10 - i,
        theme_count: 1,
        created_at: '2026-07-08T00:00:00Z',
        updated_at: '2026-07-08T00:00:00Z',
      }));
      vi.mocked(mockWikiPort.getUserWiki).mockResolvedValueOnce(mockWiki);

      const context = await service.loadUserKnowledgeContext('user-1');

      expect(context.themes.length).toBeLessThanOrEqual(5);
      expect(context.themes).toContain('Theme0'); // Highest count
    });

    it('should calculate correct total question count', async () => {
      const mockWiki = [
        {
          id: 'wiki-1',
          user_id: 'user-1',
          topic: 'Python',
          wiki_markdown: 'Content',
          question_count: 3,
          theme_count: 1,
          created_at: '2026-07-08T00:00:00Z',
          updated_at: '2026-07-08T00:00:00Z',
        },
        {
          id: 'wiki-2',
          user_id: 'user-1',
          topic: 'JavaScript',
          wiki_markdown: 'Content',
          question_count: 5,
          theme_count: 1,
          created_at: '2026-07-08T00:00:00Z',
          updated_at: '2026-07-08T00:00:00Z',
        },
      ];
      vi.mocked(mockWikiPort.getUserWiki).mockResolvedValueOnce(mockWiki);

      const context = await service.loadUserKnowledgeContext('user-1');

      expect(context.learningSummary).toContain('8 questions'); // 3 + 5
      expect(context.learningSummary).toContain('2 topics');
    });

    it('should return empty learning summary when no questions', async () => {
      const mockWiki = [
        {
          id: 'wiki-1',
          user_id: 'user-1',
          topic: 'Python',
          wiki_markdown: 'Content',
          question_count: 0,
          theme_count: 1,
          created_at: '2026-07-08T00:00:00Z',
          updated_at: '2026-07-08T00:00:00Z',
        },
      ];
      vi.mocked(mockWikiPort.getUserWiki).mockResolvedValueOnce(mockWiki);

      const context = await service.loadUserKnowledgeContext('user-1');

      expect(context.learningSummary).toBe('');
    });
  });

  describe('[Data Integrity] Pipeline correctness across multiple calls', () => {
    it('should return consistent context for same user data', async () => {
      const mockWiki = [
        {
          id: 'wiki-1',
          user_id: 'user-1',
          topic: 'Python',
          wiki_markdown: `# July 2026 Knowledge Wiki
## Python
**Questions in this theme:** 2

### FAQ
- How do I use lists?
- What are tuples?

### Common Keywords
python`,
          question_count: 2,
          theme_count: 1,
          created_at: '2026-07-08T00:00:00Z',
          updated_at: '2026-07-08T00:00:00Z',
        },
      ];

      vi.mocked(mockWikiPort.getUserWiki).mockResolvedValueOnce(mockWiki);
      const context1 = await service.loadUserKnowledgeContext('user-1');

      vi.mocked(mockWikiPort.getUserWiki).mockResolvedValueOnce(mockWiki);
      const context2 = await service.loadUserKnowledgeContext('user-1');

      // Same data should produce identical context
      expect(context1.themes).toEqual(context2.themes);
      expect(context1.faqs.map((f) => f.question)).toEqual(context2.faqs.map((f) => f.question));
      expect(context1.learningSummary).toBe(context2.learningSummary);
    });

    it('should handle topic name normalization (trimming spaces)', async () => {
      const mockWiki = [
        {
          id: 'wiki-1',
          user_id: 'user-1',
          topic: '  Python  ',
          wiki_markdown: 'Content',
          question_count: 1,
          theme_count: 1,
          created_at: '2026-07-08T00:00:00Z',
          updated_at: '2026-07-08T00:00:00Z',
        },
      ];
      vi.mocked(mockWikiPort.getUserWiki).mockResolvedValueOnce(mockWiki);

      const context = await service.loadUserKnowledgeContext('user-1');

      // Should trim whitespace from topic
      expect(context.themes[0]).toBe('Python');
    });

    it('should verify FAQs have correct theme field', async () => {
      const mockWiki = [
        {
          id: 'wiki-1',
          user_id: 'user-1',
          topic: 'Security',
          wiki_markdown: `# July 2026 Knowledge Wiki
## Security
**Questions in this theme:** 1

### FAQ
- What is encryption?

### Common Keywords
security`,
          question_count: 1,
          theme_count: 1,
          created_at: '2026-07-08T00:00:00Z',
          updated_at: '2026-07-08T00:00:00Z',
        },
      ];
      vi.mocked(mockWikiPort.getUserWiki).mockResolvedValueOnce(mockWiki);

      const context = await service.loadUserKnowledgeContext('user-1');

      expect(context.faqs.length).toBeGreaterThan(0);
      // Every FAQ should have the correct theme
      expect(context.faqs.every((faq) => faq.theme === 'Security')).toBe(true);
    });
  });
});
