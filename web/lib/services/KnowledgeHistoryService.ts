import type { UserKnowledgeContext, FAQItem } from '@/lib/types/knowledge-context';
import { EMPTY_KNOWLEDGE_CONTEXT } from '@/lib/types/knowledge-context';

/**
 * Represents a row from the public.user_knowledge_wiki table
 * Built by previous analyses via the question capture flow (Wave 4.1).
 */
interface WikiRow {
  userId: string;
  videoId: string;
  theme: string;
  question: string;
  answer: string;
  frequency?: number;
  createdAt?: string;
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

      // Group by theme and rank by frequency
      const themeMap = new Map<string, number>();
      const faqsByTheme = new Map<string, FAQItem[]>();

      for (const row of wiki) {
        const theme = row.theme?.trim() || 'General';
        const question = row.question?.trim() || '';
        const answer = row.answer?.trim() || '';

        // Skip malformed rows
        if (!question || !answer) {
          continue;
        }

        // Count theme frequency
        themeMap.set(theme, (themeMap.get(theme) ?? 0) + 1);

        // Collect FAQ items per theme
        if (!faqsByTheme.has(theme)) {
          faqsByTheme.set(theme, []);
        }
        faqsByTheme.get(theme)!.push({
          theme,
          question,
          answer,
          relevanceScore: row.frequency ?? 1,
        });
      }

      // Extract top 3-5 themes (ranked by frequency)
      const topThemes = Array.from(themeMap.entries())
        .sort(([, freqA], [, freqB]) => freqB - freqA)
        .slice(0, 5)
        .map(([theme]) => theme);

      // Extract top 3-5 FAQ items from each theme (ranked by relevance/frequency)
      const topFaqs: FAQItem[] = [];
      for (const theme of topThemes) {
        const themeFaqs = faqsByTheme.get(theme) ?? [];
        // Sort by relevance score (higher = more relevant)
        themeFaqs.sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
        // Take top 3-5 per theme
        topFaqs.push(...themeFaqs.slice(0, 5));
      }

      // Build learning summary
      const uniqueVideos = new Set(wiki.map((w) => w.videoId)).size;
      const totalQuestions = wiki.length;
      const learningSummary =
        uniqueVideos > 0
          ? `You've previously asked about: ${topThemes.join(', ')} (${totalQuestions} questions across ${uniqueVideos} videos)`
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
