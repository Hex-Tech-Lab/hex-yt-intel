import type { ChatConversation, ChatMessage } from '@/lib/types/chat';

export interface ChatPersistencePort {
  getConversations(userId: string): Promise<ChatConversation[]>;

  createConversation(params: {
    userId: string;
    analysisId: string | null;
    title: string;
    videoId?: string | null;
  }): Promise<ChatConversation>;

  getConversation(params: {
    conversationId: string;
  }): Promise<ChatConversation | null>;

  updateConversationTitle(params: {
    conversationId: string;
    title: string;
  }): Promise<void>;

  getMessages(params: {
    conversationId: string;
  }): Promise<ChatMessage[]>;

  findMessageByClientMsgId(params: {
    conversationId: string;
    clientMsgId: string;
  }): Promise<ChatMessage | null>;

  createMessage(params: {
    conversationId: string;
    userId: string;
    role: 'user' | 'assistant';
    content: string;
    clientMsgId?: string | null;
    parentMessageId?: string | null;
  }): Promise<ChatMessage>;

  findAssistantMessageAfter(params: {
    conversationId: string;
    timestamp: string;
  }): Promise<ChatMessage | null>;

  findAssistantByParentId(params: {
    conversationId: string;
    parentId: string;
  }): Promise<ChatMessage | null>;

  getAnalysisGrounding(params: {
    analysisId: string;
    /** When provided, the analysis must belong to this user or null is returned. */
    userId?: string;
  }): Promise<{
    title: string;
    channelTitle: string | null;
    description: string | null;
    analysisMarkdown: string | null;
    status: string;
    transcript?: string | null;
  } | null>;

  /**
   * Verify if the user owns the chat conversation and select optional fields.
   */
  verifyChatOwnership(params: {
    conversationId: string;
    userId: string;
    select?: string;
  }): Promise<any | null>;
}
