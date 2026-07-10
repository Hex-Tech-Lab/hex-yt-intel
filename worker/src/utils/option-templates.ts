/**
 * Predefined templates and static options for chat OPTIONS
 *
 * Ensures consistent, token-budgeted suggestions.
 * Each option: <50 chars to fit SSE event payload constraints.
 */

/**
 * Static fallback options used when no user knowledge context available.
 * Kept generic and universally applicable.
 */
export const STATIC_OPTIONS: readonly string[] = [
  "Executive summary?",
  "Key takeaways?",
  "Main insights?",
  "Any questions?",
  "Explore further?",
];

/**
 * Template patterns for adaptive option generation.
 * Formatted with placeholders for dynamic insertion.
 * All options kept <50 chars when filled.
 */
export const OPTION_TEMPLATES = {
  theme: {
    deeper: "You asked about {theme} — dig deeper?",
    explore: "Based on your {theme} interest?",
    continue: "Continue exploring {theme}?",
  },
  topicFollowUp: {
    elaborate: "Elaborate on {topic}?",
    more: "More on {topic}?",
    deeper: "Go deeper into {topic}?",
  },
  faqReference: {
    revisit: 'Revisit: "{question}"?',
    similar: "Asked this before?",
    recap: "Recap: {question}?",
  },
  relatedTheme: {
    explore: "Explore {theme} next?",
    how: "How about {theme}?",
    discover: "Discover {theme}?",
  },
  general: {
    summary: "Summarize key points?",
    details: "More details on this?",
    implications: "Real-world applications?",
    context: "Where does this fit in?",
  },
};

/**
 * Sanitize and truncate option to ensure it fits in SSE payload.
 * Max length enforced: 50 chars (safety margin for JSON encoding).
 */
export function sanitizeOption(option: string, maxLength: number = 50): string {
  return option.trim().slice(0, maxLength);
}

/**
 * Fill template with dynamic values, then sanitize.
 * Example: fillTemplate("Explore {theme}?", { theme: "security" })
 * => "Explore security?"
 */
export function fillTemplate(
  template: string,
  values: Record<string, string>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.replace(`{${key}}`, value);
  }
  return sanitizeOption(result);
}

/**
 * Validate that an option list meets constraints:
 * - 3-5 items
 * - Each item <50 chars
 * - No duplicates
 */
export function validateOptionsList(options: string[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (options.length < 3) {
    errors.push(`Expected 3-5 options, got ${options.length} (too few)`);
  }
  if (options.length > 5) {
    errors.push(`Expected 3-5 options, got ${options.length} (too many)`);
  }

  const seenOptions = new Set<string>();
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    if (!opt || typeof opt !== "string") {
      errors.push(`Option ${i}: empty or not a string`);
      continue;
    }
    if (opt.length > 50) {
      errors.push(`Option ${i} too long: ${opt.length} chars (max 50)`);
    }
    if (seenOptions.has(opt)) {
      errors.push(`Option ${i} is a duplicate`);
    }
    seenOptions.add(opt);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
