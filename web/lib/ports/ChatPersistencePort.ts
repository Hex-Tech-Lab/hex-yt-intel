import type { ChatConversation, ChatMessage } from '@/lib/types/chat';

/**
 * Handles all database operations for chat threads and messages, isolating the chat
 * domains from the database engine.
 */
export interface ChatPersistencePort {
  /**
   * List conversations for a user.
   */
  getConversations(userId: string): Promise<ChatConversation[]>;

  /**
   * Start a new chat conversation.
   */
  createConversation(params: {
    userId: string;
    analysisId: string | null;
    title: string;
  }): Promise<ChatConversation>;

  /**
   * Retrieve a single conversation.
   */
  getConversation(params: {
    conversationId: string;
  }): Promise<ChatConversation | null>;

  /**
   * Update the title of a conversation.
   */
  updateConversationTitle(params: {
    conversationId: string;
    title: string;
  }): Promise<void>;

  /**
   * Load history/messages for a thread.
   */
  getMessages(params: {
    conversationId: string;
  }): Promise<ChatMessage[]>;

  /**
   * Check if a message already exists (idempotency support).
   */
  findMessageByClientMsgId(params: {
    conversationId: string;
    clientMsgId: string;
  }): Promise<ChatMessage | null>;

  /**
   * Save a chat message.
   */
  createMessage(params: {
    conversationId: string;
    userId: string;
    role: 'user' | 'assistant';
    content: string;
    clientMsgId?: string | null;
  }): Promise<ChatMessage>;

  /**
   * Find the first assistant message created after a user message.
   */
  findAssistantMessageAfter(params: {
    conversationId: string;
    timestamp: string;
  }): Promise<ChatMessage | null>;

  /**
   * Retrieve analysis details for grounding the chat session.
   */
  getAnalysisGrounding(params: {
    analysisId: string;
  }): Promise<{
    title: string;
    channelTitle: string | null;
    analysisMarkdown: string | null;
    status: string;
  } | null>;
}
