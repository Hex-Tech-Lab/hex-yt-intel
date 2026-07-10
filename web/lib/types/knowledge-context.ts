/**
 * User Knowledge Context — extracted from Q/A wiki built by previous analyses.
 * Used to inject user's learning history into chat grounding.
 */

export interface FAQItem {
  theme: string;
  question: string;
  answer: string;
  relevanceScore?: number;
}

export interface UserKnowledgeContext {
  /** Top themes the user has asked about (ranked by frequency) */
  themes: string[];

  /** Top 3-5 FAQ items extracted from user's wiki (ranked by relevance to current conversation) */
  faqs: FAQItem[];

  /** Summary of user's learning history (e.g., "3 videos analyzed, 12 questions asked") */
  learningSummary: string;
}

/**
 * Empty knowledge context (user has no wiki history)
 */
export const EMPTY_KNOWLEDGE_CONTEXT: UserKnowledgeContext = {
  themes: [],
  faqs: [],
  learningSummary: '',
};
