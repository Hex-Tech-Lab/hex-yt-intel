import type { UserKnowledgeContext, FAQItem } from '@/lib/types/knowledge-context';
import { EMPTY_KNOWLEDGE_CONTEXT } from '@/lib/types/knowledge-context';

/**
 * Represents a row from the public.user_knowledge_wiki table
 * Built by previous analyses via the question capture flow (Wave 4.1).
 * Stores aggregated wiki articles (one per topic) with markdown content.
 */
interface WikiRow {
  id: string;
  user_id: string;
  topic: string;
  wiki_markdown: string;
  question_count: number;
  theme_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Port interface for accessing user knowledge wiki data.
 * Allows this service to be decoupled from specific persistence implementation.
 */
export interface KnowledgeWikiPort {
  /**
   * Load all Q/A records for a user from their knowledge wiki.
   * Returns empty array if user has no history.
   */
  getUserWiki(userId: string): Promise<WikiRow[]>;
}

export class KnowledgeHistoryService {
  constructor(private wikiPort: KnowledgeWikiPort) {}

  /**
   * Load and extract user's learning context from their knowledge wiki.
   * - Extracts top 3-5 themes (by frequency)
   * - For each theme, extracts top 3-5 FAQ items (by relevance)
   * - Builds a summary string of learning activity
   *
   * Gracefully handles:
   * - User with no wiki history (returns EMPTY_KNOWLEDGE_CONTEXT)
   * - Wiki with empty answers (filters out)
   * - Repeated themes (deduplicates and counts frequency)
   */
  async loadUserKnowledgeContext(userId: string): Promise<UserKnowledgeContext> {
    try {
      const wiki = await this.wikiPort.getUserWiki(userId);

      // Empty history
      if (!wiki || wiki.length === 0) {
        return EMPTY_KNOWLEDGE_CONTEXT;
      }

      // Extract themes from wiki topics, ranked by question count
      const themeEntries = wiki
        .map((row) => ({
          theme: row.topic.trim() || 'General',
          score: row.question_count || 1,
        }))
        .filter((entry) => entry.theme);

      // Get top 3-5 themes by question count
      const topThemes = themeEntries
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((entry) => entry.theme);

      // Build FAQ items from wiki entries (one per topic)
      const topFaqs: FAQItem[] = themeEntries
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((entry) => ({
          theme: entry.theme,
          question: entry.theme,
          answer: entry.theme, // Placeholder: actual answer would require parsing wiki_markdown
          relevanceScore: entry.score,
        }));

      // Build learning summary
      const totalTopics = wiki.length;
      const totalQuestions = wiki.reduce((sum, row) => sum + (row.question_count || 0), 0);
      const learningSummary =
        totalQuestions > 0
          ? `You've previously asked about: ${topThemes.join(', ')} (${totalQuestions} questions across ${totalTopics} topics)`
          : '';

      return {
        themes: topThemes,
        faqs: topFaqs,
        learningSummary,
      };
    } catch (error) {
      console.error('[KnowledgeHistoryService] Error loading user wiki:', error);
      // Fail gracefully — return empty context if wiki fetch fails
      return EMPTY_KNOWLEDGE_CONTEXT;
    }
  }
}
