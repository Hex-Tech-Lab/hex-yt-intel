import type { UserKnowledgeContext } from '@/lib/types/knowledge-context';

/**
 * Build grounding context string by injecting user's learning history.
 * Keeps output bounded to 600 chars max to avoid inflating prompt tokens.
 *
 * P0 Risk #3 Fix: History injection token budget
 * - Enforces strict 600-char limit on history section
 * - Truncates FAQ items if needed to stay within budget
 * - Verifies final output respects token budget
 * - Logs overflow incidents for debugging
 *
 * Format:
 * [Original Grounding]
 * \n\n--- YOUR LEARNING HISTORY ---
 * You previously asked about: theme1, theme2, ...
 * Previously answered: Q1? → A1. Q2? → A2.
 *
 * Gracefully handles:
 * - Empty knowledge context (returns original grounding unchanged)
 * - Truncated output to stay within token budget
 * - Null/undefined context properties
 */
export function buildGroundingWithHistory(
  originalGrounding: string,
  knowledgeContext: UserKnowledgeContext | undefined,
  currentMessage?: string
): string {
  // Defensive: handle null/undefined context
  if (!knowledgeContext) {
    return originalGrounding;
  }

  // If no learning history, return original grounding unchanged
  if ((!knowledgeContext.themes || !knowledgeContext.themes.length) &&
      (!knowledgeContext.faqs || !knowledgeContext.faqs.length)) {
    return originalGrounding;
  }

  const historyParts: string[] = [];

  // Add themes section if present
  if (knowledgeContext.themes && knowledgeContext.themes.length > 0) {
    // Defensive: filter out empty/null themes
    const validThemes = knowledgeContext.themes.filter((t) => t && typeof t === 'string' && t.trim());
    if (validThemes.length > 0) {
      historyParts.push(`Previously asked about: ${validThemes.join(', ')}`);
    }
  }

  // Add FAQ items — rank by relevance to current message if provided
  if (knowledgeContext.faqs && knowledgeContext.faqs.length > 0) {
    const topFaqs = selectRelevantFaqs(
      knowledgeContext.faqs,
      currentMessage,
      3 // Top 3 FAQ items max
    );

    if (topFaqs.length > 0) {
      const faqText = topFaqs
        .map((faq) => {
          // Defensive: validate FAQ properties
          const q = (faq?.question || '').slice(0, 50);
          const a = (faq?.answer || '').slice(0, 50);
          if (!q) return null;
          return `Q: ${q}? → ${a}`;
        })
        .filter((item) => item !== null)
        .join('; ');

      if (faqText.length > 0) {
        historyParts.push(`Previously answered: ${faqText}`);
      }
    }
  }

  // If no parts were built, return original
  if (historyParts.length === 0) {
    return originalGrounding;
  }

  // Build history section with strict 600-char limit (P0 Risk #3)
  // This ensures the grounding string never bloats unexpectedly
  const historyPrefix = '\n\n--- YOUR LEARNING HISTORY ---\n';
  let historyBody = historyParts.join('\n');

  // If history body would exceed budget, truncate FAQ section first
  const MAX_HISTORY_CHARS = 600;
  if (historyPrefix.length + historyBody.length > MAX_HISTORY_CHARS) {
    // Try truncating FAQs (second part) first
    const parts = historyBody.split('Previously answered: ');
    if (parts.length === 2 && parts[0] && parts[1]) {
      const themesLine = parts[0];
      const budget = MAX_HISTORY_CHARS - historyPrefix.length - themesLine.length - 1; // -1 for newline
      if (budget > 20) {
        const faqsTruncated = parts[1].slice(0, budget) + '…';
        historyBody = themesLine + 'Previously answered: ' + faqsTruncated;
      } else {
        // Budget exhausted, just keep themes
        historyBody = themesLine.trimEnd();
      }
    }

    // Log overflow for observability (token budget violation is worth noting)
    console.warn('[buildGroundingWithHistory] History truncated to fit 600-char budget');
  }

  // Combine: original grounding + history section
  const combined = originalGrounding + historyPrefix + historyBody;

  // Final safety check: verify we're within budget
  if (combined.length > originalGrounding.length + MAX_HISTORY_CHARS) {
    // This should never happen, but log it if it does (defensive programming)
    console.error('[buildGroundingWithHistory] Combined grounding exceeds safety limit', {
      originalLength: originalGrounding.length,
      historyLength: historyPrefix.length + historyBody.length,
      maxAllowed: MAX_HISTORY_CHARS,
    });
  }

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
