import type { ChatConversation, ChatMessage } from '@/lib/types/chat';

export interface ChatPersistencePort {
  getConversations(userId: string): Promise<ChatConversation[]>;

  createConversation(params: {
    userId: string;
    analysisId: string | null;
    title: string;
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
  }): Promise<ChatMessage>;

  findAssistantMessageAfter(params: {
    conversationId: string;
    timestamp: string;
  }): Promise<ChatMessage | null>;

  getAnalysisGrounding(params: {
    analysisId: string;
  }): Promise<{
    title: string;
    channelTitle: string | null;
    analysisMarkdown: string | null;
    status: string;
  } | null>;
}
