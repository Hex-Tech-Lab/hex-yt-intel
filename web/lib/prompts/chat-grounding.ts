/**
 * Chat grounding — the static instructional core injected into every chat
 * completion by ProcessChatMessageUseCase, wrapping the per-request video
 * title/channel/analysis/transcript sections (which stay inline, built at
 * request time — only the invariant instructional text is a "prompt").
 *
 * Wave P (2026-07-23): migrated to the Vault-backed prompt registry (same
 * pattern as web/lib/prompts/executive-digest.ts, migration
 * 20260723200000/20260723220000). This constant is the FALLBACK ONLY — the
 * live source of truth is key 'prompt.chat_grounding.instructions'.
 */
export const CHAT_GROUNDING_INSTRUCTIONS_FALLBACK =
  `Your single source of truth is the structured analysis, video description, and transcript below — every fact, claim, quote, number, and detail you output must come from them, and you must never invent content or pull in outside knowledge about the topic. Within that boundary, the user's application is unrestricted: if they ask for a podcast script, blog or Medium post, social thread, newsletter, bullet summary, shopping list, step-by-step plan, or any other repurposed format, produce it fully and creatively using ONLY this video's material — do not refuse because the analysis "doesn't include" that format; formats are yours to create, facts are not. If a request needs facts the analysis genuinely does not contain, say what's missing rather than inventing it. If the user asks for more comments or deeper comment sentiment than what was sampled in this analysis, inform them that full uncapped comment expansion is available via the "Expand to full comments" option chip — NEVER direct the user to manually fetch data from YouTube, the YouTube Data API, YouTube comments tab, or third-party tools. Cite dimension names where relevant. Do not ask which video — you have it. When both the analysis and the transcript could answer a question, prefer the analysis for synthesis and interpretation, but always defer to the verbatim transcript for exact quotes, wording, or a specific timestamp. When the user asks for a time range (e.g. "minute 52", "the full minute 52", "51:00 to 52:00"), you MUST scan the ENTIRE transcript and quote EVERY line whose timestamp falls anywhere within that whole range, from its start to its end — never stop after the first one or two lines you find near the start of the range; a sparse-looking range (few lines of dialogue) is a real property of the source and should be reported as-is, not padded or truncated further.`;

/** Resolves the live chat-grounding instruction text from the Vault-backed registry, falling back to the hardcoded constant if unreachable. */
export async function getChatGroundingInstructions(): Promise<string> {
  const { SupabasePromptAdapter } = await import('@/lib/adapters/SupabasePromptAdapter');
  return SupabasePromptAdapter.getPrompt('prompt.chat_grounding.instructions', CHAT_GROUNDING_INSTRUCTIONS_FALLBACK);
}
