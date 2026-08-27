/**
 * Static fallback OPTIONS when user has no knowledge context history.
 * Used by AdaptiveOptionsBuilder as a default when no user-specific history exists.
 * Array size and export are decoupled from the cap -- the cap is applied at
 * call site via `CHAT_REGISTRY_FALLBACK['chat.maxStarterOptions']` so no
 * magic number can drift between the static-list and the runtime slice.
 */

export const STATIC_OPTIONS = [
  "Summarize the key takeaways from this video",
  "What are the main themes discussed?",
  "Go deeper into one specific aspect",
  "How does this connect to other concepts?",
  "What are the practical applications?",
  "List the most important points",
  "Explain this in simpler terms",
  "Generate a blog post outline from this content",
  "Create a step-by-step action plan",
  "Compare this with related approaches",
];
