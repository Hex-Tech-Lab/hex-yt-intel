/**
 * useChatStore — client state for first-class chat threads.
 *
 * Postgres (via /api/chat) is the source of truth; this store is a hydrated view +
 * optimistic UI with an offline OUTBOX. Each user message carries a client
 * idempotency key; on send failure / net loss the entry stays queued and is replayed
 * on reconnect (server dedupes on client_msg_id, so retries never double-insert).
 * Replies STREAM over SSE. Mounted once (dock at layout level) → survives all nav.
 */

import { create } from 'zustand';
import type { ChatConversation, ChatMessage } from '@/lib/types/chat';
import { outbox, newClientMsgId } from '@/lib/chat/outbox';

interface ChatState {
  conversations: ChatConversation[];
  activeId: string | null;
  messagesByConv: Record<string, ChatMessage[]>;
  loadingList: boolean;
  loadingThread: boolean;
  sending: boolean;
  error: string | null;
  networkBound: boolean;

  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  newConversation: (opts?: { analysisId?: string | null; title?: string }) => Promise<string | null>;
  sendMessage: (text: string, opts?: { analysisId?: string | null }) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  bindNetwork: () => void;
  flushOutbox: () => Promise<void>;
  reset: () => void;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text().catch(() => '')}`);
  return res.json() as Promise<T>;
}

/** Read an SSE stream, dispatching each `data: {...}` JSON object. */
async function readSSE(res: Response, onEvent: (e: any) => void): Promise<void> {
  if (!res.body) throw new Error('No stream body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() || '';
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()));
      } catch {
        /* partial */
      }
    }
  }
}

export const useChatStore = create<ChatState>((set, get) => {
  /** Send one queued/optimistic message and stream the reply. Shared by send + flush. */
  async function deliver(convId: string, clientMsgId: string, content: string): Promise<void> {
    const pendingAssistantId = `pending-${clientMsgId}`;

    // Ensure optimistic rows exist (idempotent for replay).
    set((s) => {
      const list = s.messagesByConv[convId] || [];
      const hasUser = list.some((m) => m.clientMsgId === clientMsgId);
      const next = hasUser
        ? list
        : [
            ...list,
            { id: clientMsgId, conversationId: convId, role: 'user' as const, content, createdAt: new Date().toISOString(), clientMsgId },
          ];
      const hasPending = next.some((m) => m.id === pendingAssistantId);
      return {
        sending: true,
        error: null,
        messagesByConv: {
          ...s.messagesByConv,
          [convId]: hasPending ? next : [...next, { id: pendingAssistantId, conversationId: convId, role: 'assistant' as const, content: '', createdAt: new Date().toISOString() }],
        },
      };
    });

    // 1. Bouncer (Vercel): persists the user turn to Postgres, mints an HMAC token, and
    //    returns a descriptor for streaming the reply directly from the worker. Returns
    //    JSON (not SSE) — the LLM tokens no longer traverse this Vercel function.
    const res = await fetch(`/api/chat/conversations/${convId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, clientMsgId }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const job = await res.json();

    // Reconcile the optimistic user bubble with the persisted row.
    if (job.user) {
      const real = job.user as ChatMessage;
      set((s) => ({
        messagesByConv: {
          ...s.messagesByConv,
          [convId]: (s.messagesByConv[convId] || []).map((m) => (m.clientMsgId === clientMsgId ? { ...real, clientMsgId } : m)),
        },
      }));
    }
    if (job.title) {
      set((s) => ({ conversations: s.conversations.map((c) => (c.id === convId ? { ...c, title: job.title } : c)) }));
    }

    // Retry that already produced a reply on a prior attempt — finalize, no streaming.
    if (job.assistant) {
      const real = job.assistant as ChatMessage;
      set((s) => ({
        messagesByConv: {
          ...s.messagesByConv,
          [convId]: (s.messagesByConv[convId] || []).map((m) => (m.id === pendingAssistantId ? real : m)),
        },
      }));
      outbox.remove(clientMsgId);
      return;
    }

    if (!job.stream?.url) {
      set({ error: 'Chat streaming endpoint not configured (NEXT_PUBLIC_WORKER_URL).' });
      outbox.remove(clientMsgId);
      return;
    }

    // 2. Stream the reply directly from the worker. It persists the assistant turn S2S
    //    (/api/chat/persist), so the optimistic bubble below just holds the streamed
    //    text and reconciles against Postgres on the next thread load.
    const streamRes = await fetch(job.stream.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...job.payload, sig: job.stream.sig, exp: job.stream.exp }),
    });
    if (!streamRes.ok) throw new Error(`worker ${streamRes.status}`);

    await readSSE(streamRes, (e) => {
      if (e.type === 'delta') {
        set((s) => ({
          messagesByConv: {
            ...s.messagesByConv,
            [convId]: (s.messagesByConv[convId] || []).map((m) => (m.id === pendingAssistantId ? { ...m, content: m.content + e.content } : m)),
          },
        }));
      } else if (e.type === 'done') {
        // Promote the optimistic bubble to a stable id (worker already persisted it).
        set((s) => ({
          messagesByConv: {
            ...s.messagesByConv,
            [convId]: (s.messagesByConv[convId] || []).map((m) => (m.id === pendingAssistantId ? { ...m, id: `assistant-${clientMsgId}` } : m)),
          },
        }));
      } else if (e.type === 'error') {
        set({ error: String(e.error || 'reply failed') });
      }
    });

    // Delivered + persisted → clear the outbox entry.
    outbox.remove(clientMsgId);
  }

  return {
    conversations: [],
    activeId: null,
    messagesByConv: {},
    loadingList: false,
    loadingThread: false,
    sending: false,
    error: null,
    networkBound: false,

    loadConversations: async () => {
      set({ loadingList: true, error: null });
      try {
        const { conversations } = await api<{ conversations: ChatConversation[] }>('/api/chat/conversations');
        set((s) => ({
          conversations,
          loadingList: false,
          activeId: s.activeId && conversations.some((c) => c.id === s.activeId) ? s.activeId : conversations[0]?.id ?? null,
        }));
      } catch (e) {
        set({ loadingList: false, error: e instanceof Error ? e.message : 'Failed to load chats' });
      }
    },

    selectConversation: async (id) => {
      set({ activeId: id });
      if (get().messagesByConv[id]) return;
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

    sendMessage: async (text, opts) => {
      const trimmed = text.trim();
      if (!trimmed || get().sending) return;

      let convId = get().activeId;
      if (!convId) convId = await get().newConversation({ analysisId: opts?.analysisId ?? null });
      if (!convId) return;

      const clientMsgId = newClientMsgId();
      // Queue first so a crash/net-loss mid-send is recoverable on reconnect.
      outbox.add({ clientMsgId, conversationId: convId, content: trimmed, createdAt: new Date().toISOString() });

      try {
        await deliver(convId, clientMsgId, trimmed);
      } catch (e) {
        // Stays in outbox; the pending assistant bubble is dropped, user bubble kept.
        set((s) => ({
          error: e instanceof Error ? e.message : 'Send failed (queued for retry)',
          messagesByConv: {
            ...s.messagesByConv,
            [convId!]: (s.messagesByConv[convId!] || []).filter((m) => m.id !== `pending-${clientMsgId}`),
          },
        }));
      } finally {
        set({ sending: false });
      }
    },

    renameConversation: async (id, title) => {
      set((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? { ...c, title } : c)) }));
      try {
        await api(`/api/chat/conversations/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) });
      } catch {
        /* optimistic */
      }
    },

    deleteConversation: async (id) => {
      set((s) => {
        const conversations = s.conversations.filter((c) => c.id !== id);
        const rest = { ...s.messagesByConv };
        delete rest[id];
        return { conversations, messagesByConv: rest, activeId: s.activeId === id ? conversations[0]?.id ?? null : s.activeId };
      });
      try {
        await api(`/api/chat/conversations/${id}`, { method: 'DELETE' });
      } catch {
        /* already removed locally */
      }
    },

    bindNetwork: () => {
      if (get().networkBound || typeof window === 'undefined') return;
      set({ networkBound: true });
      window.addEventListener('online', () => void get().flushOutbox());
      // Attempt a flush on bind in case entries were left from a previous session.
      void get().flushOutbox();
    },

    flushOutbox: async () => {
      const entries = outbox.all();
      if (entries.length === 0 || get().sending) return;
      set({ sending: true });
      try {
        for (const e of entries) {
          try {
            await deliver(e.conversationId, e.clientMsgId, e.content);
          } catch {
            break; // still offline / failing — stop; retry on next online event
          }
        }
      } finally {
        set({ sending: false });
      }
    },

    reset: () => {
      set({
        activeId: null,
        messagesByConv: {},
        error: null,
        sending: false,
      });
    },
  };
});
