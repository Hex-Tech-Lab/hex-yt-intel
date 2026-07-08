import type { UserKnowledgeContext } from '@/lib/types/knowledge-context';

/**
 * Build grounding context string by injecting user's learning history.
 * Keeps output bounded to ~500 chars to avoid inflating prompt tokens.
 *
 * Format:
 * [Original Grounding]
 * \n\n--- USER LEARNING HISTORY ---
 * You previously asked about: theme1, theme2, ...
 * Previously answered: Q1? → A1. Q2? → A2.
 *
 * Gracefully handles:
 * - Empty knowledge context (returns original grounding unchanged)
 * - Truncated output to stay within token budget
 */
export function buildGroundingWithHistory(
  originalGrounding: string,
  knowledgeContext: UserKnowledgeContext,
  currentMessage?: string
): string {
  // If no learning history, return original grounding unchanged
  if (!knowledgeContext.themes.length && !knowledgeContext.faqs.length) {
    return originalGrounding;
  }

  const historyParts: string[] = [];

  // Add themes section if present
  if (knowledgeContext.themes.length > 0) {
    historyParts.push(`Previously asked about: ${knowledgeContext.themes.join(', ')}`);
  }

  // Add FAQ items — rank by relevance to current message if provided
  if (knowledgeContext.faqs.length > 0) {
    const topFaqs = selectRelevantFaqs(
      knowledgeContext.faqs,
      currentMessage,
      3 // Top 3 FAQ items max
    );

    if (topFaqs.length > 0) {
      const faqText = topFaqs
        .map((faq) => {
          // Truncate long answers to 80 chars to fit in token budget
          const answerPreview = faq.answer.length > 80 ? faq.answer.slice(0, 80) + '…' : faq.answer;
          return `Q: ${faq.question}? → ${answerPreview}`;
        })
        .join('; ');
      historyParts.push(`Previously answered: ${faqText}`);
    }
  }

  // If no parts were built, return original
  if (historyParts.length === 0) {
    return originalGrounding;
  }

  // Build history section (max 500 chars to stay within budget)
  const historySection = `\n\n--- YOUR LEARNING HISTORY ---\n${historyParts.join('\n')}`;

  // Combine: original grounding + history section
  const combined = originalGrounding + historySection.slice(0, 500);
  return combined;
}

/**
 * Select top N FAQ items relevant to the current message.
 * Simple relevance scoring: fuzzy keyword matching between message and FAQ question.
 */
function selectRelevantFaqs(
  faqs: Array<{ theme: string; question: string; answer: string; relevanceScore?: number }>,
  currentMessage: string | undefined,
  topN: number
): Array<{ theme: string; question: string; answer: string }> {
  if (!currentMessage || !faqs.length) {
    // No message to match against — return top N by relevance score
    return faqs.sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0)).slice(0, topN);
  }

  // Simple keyword matching: count word overlap between current message and FAQ question
  const msgWords = new Set(currentMessage.toLowerCase().split(/\W+/));
  const scored = faqs.map((faq) => {
    const faqWords = faq.question.toLowerCase().split(/\W+/);
    const overlap = faqWords.filter((w) => msgWords.has(w)).length;
    // Score = overlap + base relevance
    const score = overlap + (faq.relevanceScore ?? 0) * 0.5;
    return { ...faq, score };
  });

  // Sort by score (higher = more relevant) and take top N
  return scored.sort((a, b) => b.score - a.score).slice(0, topN);
}
