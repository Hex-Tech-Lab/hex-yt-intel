/**
 * Chat domain types — first-class conversations (threads), not auth sessions.
 * Mirrors the ChatGPT/Claude/Gemini model: durable threads, replayed history,
 * optional grounding to an analysis.
 */

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatConversation {
  id: string;
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
}
