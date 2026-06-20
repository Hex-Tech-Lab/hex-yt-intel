import { getSupabaseServiceClient } from '@/lib/supabase';
import * as Sentry from '@sentry/nextjs';
import type { ChatMessage, ChatConversation } from '@/lib/types/chat';

interface ConversationRow {
  id: string;
  user_id: string;
  title: string | null;
  analysis_id: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  client_msg_id: string | null;
}

export class SupabaseChatAdapter {
  static async getConversations(userId: string): Promise<ChatConversation[]> {
    if (!userId) return [];
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('chat_conversations')
        .select('id, user_id, title, analysis_id, created_at, updated_at, last_message_at')
        .eq('user_id', userId)
        .order('last_message_at', { ascending: false })
        .limit(100);

      if (error) {
        console.error('[SupabaseChatAdapter] getConversations failed:', error.message);
        throw error;
      }

      return (data || []).map((r: ConversationRow) => ({
        id: r.id,
        userId: r.user_id,
        title: r.title || 'Untitled',
        analysisId: r.analysis_id,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        lastMessageAt: r.last_message_at || r.created_at,
      }));
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'getConversations' },
        extra: { userId },
      });
      throw error;
    }
  }

  static async createConversation(params: {
    userId: string;
    analysisId: string | null;
    title: string;
  }): Promise<ChatConversation> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('chat_conversations')
        .insert({ user_id: params.userId, analysis_id: params.analysisId, title: params.title })
        .select('id, user_id, title, analysis_id, created_at, updated_at, last_message_at')
        .single();

      if (error || !data) {
        console.error('[SupabaseChatAdapter] createConversation failed:', error?.message);
        throw error || new Error('createConversation returned no row');
      }

      const { id, user_id, title, analysis_id, created_at, updated_at, last_message_at } = data;
      return {
        id,
        userId: user_id,
        title: title || 'Untitled',
        analysisId: analysis_id,
        createdAt: created_at,
        updatedAt: updated_at,
        lastMessageAt: last_message_at || created_at,
      };
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'createConversation' },
        extra: { userId: params.userId, analysisId: params.analysisId },
      });
      throw error;
    }
  }

  static async getConversation(params: {
    conversationId: string;
  }): Promise<ChatConversation | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('chat_conversations')
        .select('id, user_id, title, analysis_id, created_at, updated_at, last_message_at')
        .eq('id', params.conversationId)
        .maybeSingle();

      if (error) {
        console.error('[SupabaseChatAdapter] getConversation failed:', error.message);
        throw error;
      }
      if (!data) return null;

      const defaults = { title: 'Untitled', lastMessageAt: data.created_at };
      const mapping = {
        id: data.id,
        userId: data.user_id,
        analysisId: data.analysis_id,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
      return { ...mapping, title: data.title || defaults.title, lastMessageAt: data.last_message_at || defaults.lastMessageAt };
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'getConversation' },
        extra: { conversationId: params.conversationId },
      });
      throw error;
    }
  }

  static async updateConversationTitle(params: {
    conversationId: string;
    title: string;
  }): Promise<void> {
    try {
      const service = getSupabaseServiceClient();
      const { error } = await service
        .from('chat_conversations')
        .update({ title: params.title })
        .eq('id', params.conversationId);

      if (error) {
        console.error('[SupabaseChatAdapter] updateConversationTitle failed:', error.message);
        throw error;
      }
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'updateConversationTitle' },
        extra: { conversationId: params.conversationId },
      });
      throw error;
    }
  }

  static async getMessages(params: {
    conversationId: string;
  }): Promise<ChatMessage[]> {
    if (!params.conversationId) return [];
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('chat_messages')
        .select('id, conversation_id, role, content, created_at, client_msg_id')
        .eq('conversation_id', params.conversationId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[SupabaseChatAdapter] getMessages failed:', error.message);
        throw error;
      }

      return (data || []).map((r: MessageRow) => ({
        id: r.id,
        conversationId: r.conversation_id,
        role: r.role,
        content: r.content,
        createdAt: r.created_at,
        clientMsgId: r.client_msg_id ?? null,
      }));
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'getMessages' },
        extra: { conversationId: params.conversationId },
      });
      throw error;
    }
  }

  static async findMessageByClientMsgId(params: {
    conversationId: string;
    clientMsgId: string;
  }): Promise<ChatMessage | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('chat_messages')
        .select('id, conversation_id, role, content, created_at, client_msg_id')
        .eq('conversation_id', params.conversationId)
        .eq('client_msg_id', params.clientMsgId)
        .maybeSingle();

      if (error) {
        console.error('[SupabaseChatAdapter] findMessageByClientMsgId failed:', error.message);
        throw error;
      }
      if (!data) return null;

      return {
        id: data.id,
        conversationId: data.conversation_id,
        role: data.role,
        content: data.content,
        createdAt: data.created_at,
        clientMsgId: data.client_msg_id ?? null,
      };
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'findMessageByClientMsgId' },
        extra: { conversationId: params.conversationId, clientMsgId: params.clientMsgId },
      });
      throw error;
    }
  }

  static async createMessage(params: {
    conversationId: string;
    userId: string;
    role: 'user' | 'assistant';
    content: string;
    clientMsgId?: string | null;
    parentMessageId?: string | null;
  }): Promise<ChatMessage> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('chat_messages')
        .insert({
          conversation_id: params.conversationId,
          user_id: params.userId,
          role: params.role,
          content: params.content,
          client_msg_id: params.clientMsgId,
          parent_message_id: params.parentMessageId,
        })
        .select('id, conversation_id, role, content, created_at, client_msg_id, parent_message_id')
        .single();

      if (error || !data) {
        console.error('[SupabaseChatAdapter] createMessage failed:', error?.message);
        throw error || new Error('createMessage returned no row');
      }

      return {
        id: data.id,
        conversationId: data.conversation_id,
        role: data.role,
        content: data.content,
        createdAt: data.created_at,
        clientMsgId: data.client_msg_id ?? null,
        parentMessageId: data.parent_message_id ?? null,
      };
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'createMessage' },
        extra: { conversationId: params.conversationId, userId: params.userId },
      });
      throw error;
    }
  }

  static async findAssistantMessageAfter(params: {
    conversationId: string;
    timestamp: string;
  }): Promise<ChatMessage | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('chat_messages')
        .select('id, conversation_id, role, content, created_at, client_msg_id, parent_message_id')
        .eq('conversation_id', params.conversationId)
        .eq('role', 'assistant')
        .gt('created_at', params.timestamp)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[SupabaseChatAdapter] findAssistantMessageAfter failed:', error.message);
        throw error;
      }
      if (!data) return null;

      return {
        id: data.id,
        conversationId: data.conversation_id,
        role: data.role,
        content: data.content,
        createdAt: data.created_at,
        clientMsgId: data.client_msg_id ?? null,
        parentMessageId: data.parent_message_id ?? null,
      };
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'findAssistantMessageAfter' },
        extra: { conversationId: params.conversationId, timestamp: params.timestamp },
      });
      throw error;
    }
  }

  static async findAssistantByParentId(params: {
    conversationId: string;
    parentId: string;
  }): Promise<ChatMessage | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('chat_messages')
        .select('id, conversation_id, role, content, created_at, client_msg_id, parent_message_id')
        .eq('conversation_id', params.conversationId)
        .eq('role', 'assistant')
        .eq('parent_message_id', params.parentId)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[SupabaseChatAdapter] findAssistantByParentId failed:', error.message);
        throw error;
      }
      if (!data) return null;

      return {
        id: data.id,
        conversationId: data.conversation_id,
        role: data.role,
        content: data.content,
        createdAt: data.created_at,
        clientMsgId: data.client_msg_id ?? null,
        parentMessageId: data.parent_message_id ?? null,
      };
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'findAssistantByParentId' },
        extra: { conversationId: params.conversationId, parentId: params.parentId },
      });
      throw error;
    }
  }

  static async verifyOwnership(params: {
    conversationId: string;
    userId: string;
    select?: string;
  }): Promise<any | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('chat_conversations')
        .select(params.select || '*')
        .eq('id', params.conversationId)
        .eq('user_id', params.userId)
        .maybeSingle();

      if (error) {
        console.error('[SupabaseChatAdapter] verifyOwnership failed:', error.message);
        throw error;
      }
      return data;
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'verifyOwnership' },
        extra: { conversationId: params.conversationId, userId: params.userId },
      });
      throw error;
    }
  }
}
