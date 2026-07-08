/**
 * Adaptive OPTIONS Generator for Chat Streaming
 *
 * Generates personalized follow-up options based on user's learning journey
 * (themes, FAQs, previously asked questions). Falls back to static options
 * if no knowledge context is available.
 *
 * Inputs:
 * - userContext: UserKnowledgeContext (themes, FAQs, summary)
 * - currentConversation: string (current topic/message content)
 *
 * Output: 3-5 adaptive options tailored to user's learning path
 */

import { STATIC_OPTIONS } from "./option-templates";

export interface UserKnowledgeContext {
  themes?: string[]; // User's learning topics (e.g., "security", "performance")
  faqs?: Array<{ question: string; answer: string }>; // Previously asked questions
  summary?: string; // High-level summary of user's knowledge
  recentTopics?: string[]; // Topics from recent conversations
}

/**
 * Main builder: generates adaptive OPTIONS based on user context
 * Fallback to static OPTIONS if context is empty
 */
export async function buildAdaptiveOptions(
  userContext: UserKnowledgeContext | undefined,
  currentConversation: string,
): Promise<string[]> {
  // No context — use static fallback
  if (!userContext || (!userContext.themes?.length && !userContext.faqs?.length)) {
    return getStaticOptions();
  }

  const options: string[] = [];

  // Strategy 1: Reference user's themes if relevant to conversation
  if (userContext.themes && userContext.themes.length > 0) {
    const themeOption = generateThemeOption(userContext.themes, currentConversation);
    if (themeOption) options.push(themeOption);
  }

  // Strategy 2: Suggest follow-up on topic mentioned in current conversation
  if (currentConversation.length > 0) {
    const topicOption = generateTopicFollowUpOption(currentConversation);
    if (topicOption && !options.includes(topicOption)) {
      options.push(topicOption);
    }
  }

  // Strategy 3: Reference similar FAQ if one exists
  if (userContext.faqs && userContext.faqs.length > 0) {
    const faqOption = generateFAQReferenceOption(userContext.faqs, currentConversation);
    if (faqOption && !options.includes(faqOption)) {
      options.push(faqOption);
    }
  }

  // Strategy 4: Suggest exploration of related theme
  if (userContext.themes && userContext.themes.length > 1) {
    const relatedOption = generateRelatedThemeOption(userContext.themes);
    if (relatedOption && !options.includes(relatedOption)) {
      options.push(relatedOption);
    }
  }

  // Fallback: add static option if not enough adaptive options generated
  if (options.length === 0) {
    return getStaticOptions();
  }

  // Slice to 3-5 options
  return options.slice(0, 5);
}

/**
 * Generate option referencing user's learning theme
 */
function generateThemeOption(themes: string[] | undefined, currentConversation: string): string | null {
  if (!themes || !themes.length) return null;

  // Pick a theme that might relate to conversation
  const theme = themes[0];
  if (!theme) return null;

  const templates = [
    `You asked about ${theme} before — dig deeper?`,
    `Based on your ${theme} interest, explore more?`,
    `Continue exploring ${theme}?`,
  ];

  const selectedTemplate = templates[Math.floor(Math.random() * templates.length)];
  return selectedTemplate ? selectedTemplate.slice(0, 50) : null;
}

/**
 * Generate option for following up on current topic
 */
function generateTopicFollowUpOption(currentConversation: string): string | null {
  // Extract a key word from conversation (simple heuristic)
  const words = currentConversation
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 5 && !["video", "about", "would", "could"].includes(w));

  if (words.length === 0) return null;

  const keyword = words[0];
  if (!keyword) return null;

  const templates = [
    `Elaborate on ${keyword}?`,
    `More on ${keyword}?`,
    `Go deeper into ${keyword}?`,
  ];

  const selectedTemplate = templates[Math.floor(Math.random() * templates.length)];
  return selectedTemplate ? selectedTemplate.slice(0, 50) : null;
}

/**
 * Reference a previously asked similar question
 */
function generateFAQReferenceOption(
  faqs: Array<{ question: string; answer: string }> | undefined,
  currentConversation: string,
): string | null {
  if (!faqs || faqs.length === 0) return null;

  // Pick a random FAQ for now (in production, could use similarity scoring)
  const faq = faqs[Math.floor(Math.random() * faqs.length)];
  if (!faq || !faq.question) return null;

  const shortQ = faq.question.slice(0, 30).replace(/\?$/, "");
  return `Revisit: "${shortQ}"?`.slice(0, 50);
}

/**
 * Suggest exploring a related theme
 */
function generateRelatedThemeOption(themes: string[] | undefined): string | null {
  if (!themes || themes.length < 2) return null;

  // Pick a theme different from the first
  const relatedTheme = themes[Math.floor(Math.random() * (themes.length - 1)) + 1];
  if (!relatedTheme) return null;

  const templates = [
    `Explore ${relatedTheme} next?`,
    `How about ${relatedTheme}?`,
    `Discover ${relatedTheme}?`,
  ];

  const selectedTemplate = templates[Math.floor(Math.random() * templates.length)];
  return selectedTemplate ? selectedTemplate.slice(0, 50) : null;
}

/**
 * Return static fallback options (used when no user context)
 */
export function getStaticOptions(): string[] {
  return STATIC_OPTIONS.slice(0, 5);
}
