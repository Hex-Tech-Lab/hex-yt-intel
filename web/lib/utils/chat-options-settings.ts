/**
 * Chat seed / starter-options Settings Registry keys + typed fallbacks.
 * Single source of truth for how many follow-up suggestion chips the chat
 * adapter is allowed to produce and the UI is allowed to render. The prompt
 * copy and the static-fallback list both derive from MAX_STARTER_OPTIONS, so
 * no hardcoded numeric literal can drift between the three layers.
 */
export const CHAT_REGISTRY_FALLBACK = {
  'chat.maxStarterOptions': 10,
} as const;
