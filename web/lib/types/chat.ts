/**
 * Chat domain types — first-class conversations (threads), not auth sessions.
 * Mirrors the ChatGPT/Claude/Gemini model: durable threads, replayed history,
 * optional grounding to an analysis.
 */

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatConversation {
  id: string;
  userId: string;
  title: string;
  /** Optional analysis this thread is grounded in (nullable = general chat). */
  analysisId: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  /** Client idempotency key (user messages only); lets the outbox reconcile retries. */
  clientMsgId?: string | null;
  /** Stable parent identifier mapping assistant replies to user messages. */
  parentMessageId?: string | null;
}

export interface DeltaEvent {
  type: 'delta';
  content: string;
}

export interface DoneEvent {
  type: 'done';
}

export interface PersistEvent {
  type: 'persist';
  status: 'saving' | 'saved' | 'failed' | 'aborted';
}

export interface ErrorEvent {
  type: 'error';
  error: string;
}

export type ChatSSEEvent = DeltaEvent | DoneEvent | PersistEvent | ErrorEvent;
