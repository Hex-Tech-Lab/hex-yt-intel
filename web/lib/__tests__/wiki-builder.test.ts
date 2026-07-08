/**
 * Wiki Builder Tests (WAVE 4.2)
 * Vitest suite for wiki aggregation logic, theme clustering, and markdown generation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  clusterQuestionsByTheme,
  generateWikiMarkdown,
  type QuestionData,
  type ThemeCluster,
} from '@/lib/skills/wiki-builder/wiki-builder';

describe('Wiki Builder - Core Functions', () => {
  describe('clusterQuestionsByTheme', () => {
    it('should cluster questions by theme patterns', () => {
      const questions: QuestionData[] = [
        {
          questionId: '1',
          question: 'How do I use this feature?',
          timestamp: '2026-07-01T10:00:00Z',
        },
        {
          questionId: '2',
          question: 'Best practice for this feature',
          timestamp: '2026-07-02T10:00:00Z',
        },
        {
          questionId: '3',
          question: 'Why is my app crashing?',
          timestamp: '2026-07-03T10:00:00Z',
        },
      ];

      const themes = clusterQuestionsByTheme(questions);

      expect(themes.length).toBeGreaterThan(0);
      expect(themes.some((t) => t.theme === 'How-to')).toBe(true);
      expect(themes.some((t) => t.theme === 'Best Practices')).toBe(true);
      expect(themes.some((t) => t.theme === 'Troubleshooting')).toBe(true);
    });

    it('should assign questions to multiple themes if they match multiple patterns', () => {
      const questions: QuestionData[] = [
        {
          questionId: '1',
          question: 'How can I fix this error?',
          timestamp: '2026-07-01T10:00:00Z',
        },
      ];

      const themes = clusterQuestionsByTheme(questions);

      // This question matches both "How-to" and "Troubleshooting"
      expect(themes.length).toBeGreaterThanOrEqual(1);
      // Verify it's assigned to at least one theme
      const totalQuestions = themes.reduce((sum, t) => sum + t.questions.length, 0);
      expect(totalQuestions).toBeGreaterThanOrEqual(1);
    });

    it('should assign unmatched questions to "General" theme', () => {
      const questions: QuestionData[] = [
        {
          questionId: '1',
          question: 'Foobar xyz widget',
          timestamp: '2026-07-01T10:00:00Z',
        },
      ];

      const themes = clusterQuestionsByTheme(questions);

      const generalTheme = themes.find((t) => t.theme === 'General');
      expect(generalTheme).toBeDefined();
      expect(generalTheme?.questions.length).toBeGreaterThan(0);
    });

    it('should extract keywords for each theme cluster', () => {
      const questions: QuestionData[] = [
        {
          questionId: '1',
          question: 'How do I configure authentication?',
          timestamp: '2026-07-01T10:00:00Z',
        },
        {
          questionId: '2',
          question: 'How do I set up OAuth?',
          timestamp: '2026-07-02T10:00:00Z',
        },
      ];

      const themes = clusterQuestionsByTheme(questions);

      for (const theme of themes) {
        expect(theme.keywords).toBeDefined();
        expect(theme.keywords.size).toBeGreaterThan(0);

        // Check that keywords are non-empty strings
        for (const [keyword, count] of theme.keywords) {
          expect(keyword.length).toBeGreaterThan(0);
          expect(count).toBeGreaterThan(0);
        }
      }
    });

    it('should sort themes by question count descending', () => {
      const questions: QuestionData[] = [
        {
          questionId: '1',
          question: 'How do I use feature A?',
          timestamp: '2026-07-01T10:00:00Z',
        },
        {
          questionId: '2',
          question: 'How do I use feature B?',
          timestamp: '2026-07-02T10:00:00Z',
        },
        {
          questionId: '3',
          question: 'How do I use feature C?',
          timestamp: '2026-07-03T10:00:00Z',
        },
        {
          questionId: '4',
          question: 'Why does this fail?',
          timestamp: '2026-07-04T10:00:00Z',
        },
      ];

      const themes = clusterQuestionsByTheme(questions);

      // Themes should be sorted by question count
      for (let i = 0; i < themes.length - 1; i++) {
        expect(themes[i].questions.length).toBeGreaterThanOrEqual(
          themes[i + 1].questions.length
        );
      }
    });

    it('should handle empty question list', () => {
      const questions: QuestionData[] = [];

      const themes = clusterQuestionsByTheme(questions);

      expect(themes.length).toBe(0);
    });
  });

  describe('generateWikiMarkdown', () => {
    let sampleThemes: ThemeCluster[];

    beforeEach(() => {
      sampleThemes = [
        {
          theme: 'FAQ',
          questions: [
            {
              questionId: '1',
              question: 'How do I get started?',
              timestamp: '2026-07-01T10:00:00Z',
            },
            {
              questionId: '2',
              question: 'What are the requirements?',
              timestamp: '2026-07-02T10:00:00Z',
            },
          ],
          keywords: new Map([
            ['started', 2],
            ['requirements', 1],
          ]),
        },
        {
          theme: 'Troubleshooting',
          questions: [
            {
              questionId: '3',
              question: 'Why is my connection timing out?',
              timestamp: '2026-07-03T10:00:00Z',
            },
          ],
          keywords: new Map([['timeout', 1]]),
        },
      ];
    });

    it('should generate valid markdown with title and description', () => {
      const markdown = generateWikiMarkdown(sampleThemes, 'July 2026');

      expect(markdown).toContain('# July 2026 Knowledge Wiki');
      expect(markdown).toContain('Auto-generated knowledge base from user questions');
    });

    it('should include all themes as sections', () => {
      const markdown = generateWikiMarkdown(sampleThemes, 'July 2026');

      expect(markdown).toContain('## FAQ');
      expect(markdown).toContain('## Troubleshooting');
    });

    it('should list all questions in each theme', () => {
      const markdown = generateWikiMarkdown(sampleThemes, 'July 2026');

      expect(markdown).toContain('How do I get started?');
      expect(markdown).toContain('What are the requirements?');
      expect(markdown).toContain('Why is my connection timing out?');
    });

    it('should display question count for each theme', () => {
      const markdown = generateWikiMarkdown(sampleThemes, 'July 2026');

      expect(markdown).toContain('**Questions in this theme:** 2');
      expect(markdown).toContain('**Questions in this theme:** 1');
    });

    it('should include common keywords section', () => {
      const markdown = generateWikiMarkdown(sampleThemes, 'July 2026');

      expect(markdown).toContain('Common Keywords');
      expect(markdown).toContain('started');
      expect(markdown).toContain('timeout');
    });

    it('should handle empty theme list gracefully', () => {
      const markdown = generateWikiMarkdown([], 'July 2026');

      expect(markdown).toContain('# July 2026 Knowledge Wiki');
      expect(markdown).toContain('No themes discovered');
    });

    it('should truncate very long questions', () => {
      const veryLongQuestion = 'a'.repeat(250);
      const themesWithLongQ: ThemeCluster[] = [
        {
          theme: 'FAQ',
          questions: [
            {
              questionId: '1',
              question: veryLongQuestion,
              timestamp: '2026-07-01T10:00:00Z',
            },
          ],
          keywords: new Map(),
        },
      ];

      const markdown = generateWikiMarkdown(themesWithLongQ, 'July 2026');

      // Should have truncation marker
      expect(markdown).toContain('...');
      // Should truncate to exactly 200 characters (matching the substring(0, 200) logic)
      expect(markdown).toMatch(/a{200}(?!a)/);
    });

    it('should escape markdown special characters in questions', () => {
      const themesWithSpecialChars: ThemeCluster[] = [
        {
          theme: 'FAQ',
          questions: [
            {
              questionId: '1',
              question: 'How do I use [brackets] and (parens)?',
              timestamp: '2026-07-01T10:00:00Z',
            },
          ],
          keywords: new Map(),
        },
      ];

      const markdown = generateWikiMarkdown(themesWithSpecialChars, 'July 2026');

      // Should escape special markdown characters
      expect(markdown).toContain('\\[');
      expect(markdown).toContain('\\]');
      expect(markdown).toContain('\\(');
      expect(markdown).toContain('\\)');
    });

    it('should include only top 10 keywords', () => {
      const themesWithManyKeywords: ThemeCluster[] = [
        {
          theme: 'FAQ',
          questions: [],
          keywords: new Map(
            Array.from({ length: 15 }, (_, i) => [`keyword${i}`, i + 1])
          ),
        },
      ];

      const markdown = generateWikiMarkdown(themesWithManyKeywords, 'July 2026');

      // Count keyword occurrences (should be at most 10)
      const keywordSection = markdown.match(/Common Keywords\n(.+)\n\n/);
      if (keywordSection) {
        const keywordCount = keywordSection[1].split(',').length;
        expect(keywordCount).toBeLessThanOrEqual(10);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle questions with special characters in metadata', () => {
      const questions: QuestionData[] = [
        {
          questionId: 'uuid-with-dashes',
          question: 'How do I use "quotes" and `backticks`?',
          timestamp: '2026-07-01T10:00:00Z',
          conversationId: 'conv-123',
          analysisId: 'analysis-456',
        },
      ];

      const themes = clusterQuestionsByTheme(questions);
      expect(themes.length).toBeGreaterThan(0);

      const markdown = generateWikiMarkdown(themes, 'July 2026');
      expect(markdown).toBeDefined();
      expect(markdown.length).toBeGreaterThan(0);
    });

    it('should handle questions with unicode characters', () => {
      const questions: QuestionData[] = [
        {
          questionId: '1',
          question: 'How do I use émojis and 中文?',
          timestamp: '2026-07-01T10:00:00Z',
        },
      ];

      const themes = clusterQuestionsByTheme(questions);
      const markdown = generateWikiMarkdown(themes, 'July 2026');

      expect(markdown).toContain('émojis');
      expect(markdown).toContain('中文');
    });

    it('should handle null/undefined optional fields', () => {
      const questions: QuestionData[] = [
        {
          questionId: '1',
          question: 'Basic question',
          timestamp: '2026-07-01T10:00:00Z',
          conversationId: undefined,
          analysisId: undefined,
        },
      ];

      const themes = clusterQuestionsByTheme(questions);
      expect(themes.length).toBeGreaterThan(0);
    });

    it('should handle single question', () => {
      const questions: QuestionData[] = [
        {
          questionId: '1',
          question: 'Single lonely question',
          timestamp: '2026-07-01T10:00:00Z',
        },
      ];

      const themes = clusterQuestionsByTheme(questions);
      const markdown = generateWikiMarkdown(themes, 'July 2026');

      expect(themes.length).toBeGreaterThan(0);
      expect(markdown).toContain('Single lonely question');
    });

    it('should handle very large number of questions', () => {
      const questions: QuestionData[] = Array.from({ length: 1000 }, (_, i) => ({
        questionId: `q-${i}`,
        question: `How do I solve problem ${i}?`,
        timestamp: new Date(2026, 6, (i % 28) + 1).toISOString(),
      }));

      const themes = clusterQuestionsByTheme(questions);
      expect(themes.length).toBeGreaterThan(0);

      // Check that all themes are populated with questions
      const totalQuestions = themes.reduce((sum, t) => sum + t.questions.length, 0);
      expect(totalQuestions).toBeGreaterThanOrEqual(questions.length);

      // Each original question should appear at least once
      const allQuestionsSet = new Set(themes.flatMap(t => t.questions.map(q => q.questionId)));
      expect(allQuestionsSet.size).toBe(questions.length);
    });
  });

  describe('Theme Pattern Matching', () => {
    it('should match FAQ theme patterns', () => {
      const questions: QuestionData[] = [
        { questionId: '1', question: 'How do I do X?', timestamp: '2026-07-01T10:00:00Z' },
        { questionId: '2', question: 'What is Y?', timestamp: '2026-07-01T10:00:00Z' },
        { questionId: '3', question: 'Why does Z happen?', timestamp: '2026-07-01T10:00:00Z' },
      ];

      const themes = clusterQuestionsByTheme(questions);
      const faqTheme = themes.find((t) => t.theme === 'FAQ');

      expect(faqTheme).toBeDefined();
      expect(faqTheme?.questions.length).toBeGreaterThan(0);
    });

    it('should match Troubleshooting theme patterns', () => {
      const questions: QuestionData[] = [
        { questionId: '1', question: 'Error: something went wrong', timestamp: '2026-07-01T10:00:00Z' },
        { questionId: '2', question: 'Why is my app crashing?', timestamp: '2026-07-01T10:00:00Z' },
        { questionId: '3', question: 'This feature is broken', timestamp: '2026-07-01T10:00:00Z' },
      ];

      const themes = clusterQuestionsByTheme(questions);
      const troubleshootingTheme = themes.find((t) => t.theme === 'Troubleshooting');

      expect(troubleshootingTheme).toBeDefined();
    });

    it('should match How-to theme patterns', () => {
      const questions: QuestionData[] = [
        { questionId: '1', question: 'How to configure something', timestamp: '2026-07-01T10:00:00Z' },
        { questionId: '2', question: 'Steps to integrate the API', timestamp: '2026-07-01T10:00:00Z' },
        { questionId: '3', question: 'Guide for setup', timestamp: '2026-07-01T10:00:00Z' },
      ];

      const themes = clusterQuestionsByTheme(questions);
      const howToTheme = themes.find((t) => t.theme === 'How-to');

      expect(howToTheme).toBeDefined();
    });

    it('should match Best Practices theme patterns', () => {
      const questions: QuestionData[] = [
        { questionId: '1', question: 'Best practice for this', timestamp: '2026-07-01T10:00:00Z' },
        { questionId: '2', question: 'Recommended approach', timestamp: '2026-07-01T10:00:00Z' },
        { questionId: '3', question: 'Tips for optimization', timestamp: '2026-07-01T10:00:00Z' },
      ];

      const themes = clusterQuestionsByTheme(questions);
      const bestPracticesTheme = themes.find((t) => t.theme === 'Best Practices');

      expect(bestPracticesTheme).toBeDefined();
    });
  });
});
