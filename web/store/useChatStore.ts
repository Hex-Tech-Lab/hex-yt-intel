/**
 * useChatStore — client state for first-class chat threads.
 *
 * Postgres (via /api/chat) is the source of truth; this store is a hydrated view +
 * optimistic UI. Mounted once (the dock lives at layout level) so it survives all
 * navigation/window/UI changes. A user can start a new conversation any time and
 * ask anything — threads are independent and optionally grounded in an analysis.
 */

import { create } from 'zustand';
import type { ChatConversation, ChatMessage } from '@/lib/types/chat';

interface ChatState {
  conversations: ChatConversation[];
  activeId: string | null;
  messagesByConv: Record<string, ChatMessage[]>;
  loadingList: boolean;
  loadingThread: boolean;
  sending: boolean;
  error: string | null;

  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  newConversation: (opts?: { analysisId?: string | null; title?: string }) => Promise<string | null>;
  sendMessage: (text: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
}

const tmpId = () => `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text().catch(() => '')}`);
  return res.json() as Promise<T>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeId: null,
  messagesByConv: {},
  loadingList: false,
  loadingThread: false,
  sending: false,
  error: null,

  loadConversations: async () => {
    set({ loadingList: true, error: null });
    try {
      const { conversations } = await api<{ conversations: ChatConversation[] }>('/api/chat/conversations');
      set((s) => ({
        conversations,
        loadingList: false,
        // Keep current active if still present, else pick the most recent.
        activeId: s.activeId && conversations.some((c) => c.id === s.activeId) ? s.activeId : conversations[0]?.id ?? null,
      }));
    } catch (e) {
      set({ loadingList: false, error: e instanceof Error ? e.message : 'Failed to load chats' });
    }
  },

  selectConversation: async (id) => {
    set({ activeId: id });
    if (get().messagesByConv[id]) return; // already hydrated
    set({ loadingThread: true });
    try {
      const { messages } = await api<{ messages: ChatMessage[] }>(`/api/chat/conversations/${id}/messages`);
      set((s) => ({ messagesByConv: { ...s.messagesByConv, [id]: messages }, loadingThread: false }));
    } catch (e) {
      set({ loadingThread: false, error: e instanceof Error ? e.message : 'Failed to load thread' });
    }
  },

  newConversation: async (opts) => {
    try {
      const { conversation } = await api<{ conversation: ChatConversation }>('/api/chat/conversations', {
        method: 'POST',
        body: JSON.stringify({ analysisId: opts?.analysisId ?? null, title: opts?.title }),
      });
      set((s) => ({
        conversations: [conversation, ...s.conversations],
        activeId: conversation.id,
        messagesByConv: { ...s.messagesByConv, [conversation.id]: [] },
      }));
      return conversation.id;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to start chat' });
      return null;
    }
  },

  sendMessage: async (text) => {
    const trimmed = text.trim();
    if (!trimmed || get().sending) return;

    // Ensure there's an active conversation (lazily create one).
    let convId = get().activeId;
    if (!convId) convId = await get().newConversation();
    if (!convId) return;

    const optimistic: ChatMessage = {
      id: tmpId(),
      conversationId: convId,
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    set((s) => ({
      sending: true,
      error: null,
      messagesByConv: { ...s.messagesByConv, [convId!]: [...(s.messagesByConv[convId!] || []), optimistic] },
    }));

    try {
      const { userMessage, assistantMessage, title } = await api<{
        userMessage: ChatMessage;
        assistantMessage: ChatMessage;
        title?: string;
      }>(`/api/chat/conversations/${convId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: trimmed }),
      });

      set((s) => {
        const prior = (s.messagesByConv[convId!] || []).filter((m) => m.id !== optimistic.id);
        const conversations = title
          ? s.conversations.map((c) => (c.id === convId ? { ...c, title } : c))
          : s.conversations;
        return {
          sending: false,
          conversations,
          messagesByConv: { ...s.messagesByConv, [convId!]: [...prior, userMessage, assistantMessage] },
        };
      });
    } catch (e) {
      set({ sending: false, error: e instanceof Error ? e.message : 'Send failed' });
    }
  },

  renameConversation: async (id, title) => {
    set((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? { ...c, title } : c)) }));
    try {
      await api(`/api/chat/conversations/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) });
    } catch {
      /* optimistic; non-critical */
    }
  },

  deleteConversation: async (id) => {
    set((s) => {
      const conversations = s.conversations.filter((c) => c.id !== id);
      const rest = { ...s.messagesByConv };
      delete rest[id];
      return {
        conversations,
        messagesByConv: rest,
        activeId: s.activeId === id ? conversations[0]?.id ?? null : s.activeId,
      };
    });
    try {
      await api(`/api/chat/conversations/${id}`, { method: 'DELETE' });
    } catch {
      /* already removed locally */
    }
  },
}));
