/**
 * Comments-expansion chip decision (ADR-043 Part A).
 *
 * A turn whose stream carried intent metadata follows the server's contract: the
 * chip is offered unless `suppressCommentsChip`. The keyword trigger is not used on
 * that path. A turn with no intent metadata (router disabled) keeps the legacy
 * keyword check, so disabled behaviour is unchanged.
 */

import { ChatTurnIntentMetaSchema } from '@/lib/validators/chat-intent';
import type { ChatTurnIntentMeta } from '@/lib/types/chat-intent';

const LEGACY_COMMENT_KEYWORDS = /comment|viewer|audience|feedback|sentiment|reaction/i;

/** Validates the intent fields on an SSE `meta` frame. Returns null when the frame carries none. */
export function parseTurnIntentMeta(frame: Record<string, unknown>): ChatTurnIntentMeta | null {
  // Cheap key check first: this runs on every SSE frame, and only the meta frame carries intentVersion.
  if (!('intentVersion' in frame)) return null;
  const parsed = ChatTurnIntentMetaSchema.safeParse(frame);
  return parsed.success ? parsed.data : null;
}

export function shouldOfferCommentsChip(input: {
  hasMoreComments: boolean | undefined;
  intentMeta: ChatTurnIntentMeta | null | undefined;
  userText: string;
  assistantText: string;
}): boolean {
  if (!input.hasMoreComments) return false;
  if (input.intentMeta) return !input.intentMeta.suppressCommentsChip;
  return LEGACY_COMMENT_KEYWORDS.test(`${input.userText} ${input.assistantText}`);
}
