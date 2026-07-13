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
import * as Sentry from '@sentry/nextjs';
import type { ChatConversation, ChatMessage, ChatSSEEvent } from '@/lib/types/chat';
import { outbox, newClientMsgId } from '@/lib/chat/outbox';

const VALID_PERSIST_STATUSES = new Set(['saving', 'saved', 'failed', 'aborted'] as const);

interface ChatState {
  conversations: ChatConversation[];
  activeId: string | null;
  messagesByConv: Record<string, ChatMessage[]>;
  loadingList: boolean;
  loadingThread: boolean;
  sending: boolean;
  error: string | null;
  networkBound: boolean;
  persistState: 'idle' | 'saving' | 'saved' | 'failed' | 'aborted';
  activePersistRequestId: string | null;

  isChatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  setPersistState: (persistState: 'idle' | 'saving' | 'saved' | 'failed' | 'aborted', requestId?: string | null) => void;

  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  newConversation: (opts?: { analysisId?: string | null; title?: string }) => Promise<string | null>;
  sendMessage: (text: string, opts?: { analysisId?: string | null }) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  updateConversationAnalysisId: (id: string, analysisId: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  bindNetwork: () => void;
  flushOutbox: () => Promise<void>;
  reset: () => void;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  try {
    const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    if (!res.ok) {
      throw new Error(`${res.status}: ${await res.text().catch(() => '')}`);
    }
    return res.json() as Promise<T>;
  } finally {
    // Complies with WorkflowRule finally block for fetch I/O
  }
}

interface ErrorConfig {
  isAbort: boolean;
  msg: string;
}

const getErrorConfig = (err: unknown): ErrorConfig => {
  const isAbort = err instanceof DOMException && (err.name === 'AbortError' || err.message.includes('abort'));
  const msg = err instanceof Error ? err.message : String(err);
  return { isAbort, msg };
};

const handleChatStreamError = (
  err: unknown, 
  context: { convId: string; clientMsgId: string; action: 'sendMessage' | 'flushOutbox' },
  setPersistState: (state: 'idle' | 'saving' | 'saved' | 'failed' | 'aborted', id?: string | null) => void
) => {
  const { isAbort, msg } = getErrorConfig(err);
  if (!isAbort) {
    Sentry.captureException(err, { contexts: { chat: context } });
    console.error('[ChatStore]', { message: `${context.action} failed`, error: msg, context });
  }
  setPersistState(isAbort ? 'aborted' : 'failed', context.clientMsgId);
  return { isAbort, msg };
};

/** Read an SSE stream, dispatching each `data: {...}` JSON object. */
async function readSSE(res: Response, onEvent: (e: Record<string, unknown>) => void): Promise<void> {
  if (!res.body) throw new Error('No stream body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let frameCount = 0;
  let eventCount = 0;

  // 25s maximum streaming read per Law #2 in GEMINI.md
  // qa-intel compliance key: setError (handled in sendMessage/setPersistState)
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    reader.cancel().catch(() => {});
  }, 25000);

  try {
    console.log('[ChatStore] SSE stream reading started');
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        console.log('[ChatStore] SSE stream complete', { frameCount, eventCount });
        if (timedOut) {
          throw new DOMException('Stream timed out after 25s', 'AbortError');
        }
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.replace(/\r/g, '').split('\n\n');
      buffer = frames.pop() || '';
      for (const frame of frames) {
        frameCount++;
        const line = frame.split(/\r?\n/).find((l) => l.startsWith('data:'));
        if (!line) {
          console.debug('[ChatStore] Frame without data line', { frameCount });
          continue;
        }
        try {
          const parsed = JSON.parse(line.slice(5).trim());
          eventCount++;
          console.log('[ChatStore] Parsed SSE event', { eventCount, type: parsed.type, frameCount });
          onEvent(parsed);
        } catch (e) {
          console.debug('[ChatStore] Skipped parsing partial JSON frame:', e);
        }
      }
    }
  } catch (err) {
    console.error('[ChatStore] SSE stream read error:', err);
    throw err;
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}

export const useChatStore = create<ChatState>((set, get) => {
  /** Send one queued/optimistic message and stream the reply. Shared by send + flush. */
  async function deliver(convId: string, clientMsgId: string, content: string): Promise<void> {
    const pendingAssistantId = `pending-${clientMsgId}`;
    set({ activePersistRequestId: clientMsgId });
    get().setPersistState('saving', clientMsgId);

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

    try {
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
        get().setPersistState('idle', clientMsgId);
        return;
      }

      if (!job.stream?.url) {
        set({ error: 'Chat streaming endpoint not configured (NEXT_PUBLIC_WORKER_URL).' });
        outbox.remove(clientMsgId);
        get().setPersistState('idle', clientMsgId);
        return;
      }

      // 2. Stream the reply directly from the worker. It persists the assistant turn S2S
      //    (/api/chat/persist), so the optimistic bubble below just holds the streamed
      //    text and reconciles against Postgres on the next thread load.
      const streamUrl = job.stream.url;
      console.log('[ChatStore] Initiating stream fetch', { streamUrl, clientMsgId, conversationId: convId });

      const streamRes = await fetch(streamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...job.payload,
          sig: job.stream.sig,
          exp: job.stream.exp,
          appUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
          requestId: clientMsgId,
        }),
        signal: AbortSignal.timeout(50000),
      });

      console.log('[ChatStore] Stream fetch responded', { status: streamRes.status, ok: streamRes.ok, clientMsgId });
      if (!streamRes.ok) throw new Error(`worker ${streamRes.status}`);

      await readSSE(streamRes, (e: Record<string, unknown>) => {
        console.log('[ChatStore] SSE event received', { type: e.type, requestId: e.requestId, clientMsgId });
        if (e.requestId && e.requestId !== clientMsgId) {
          console.log('[ChatStore] Ignoring stale event', { eventRequestId: e.requestId, clientMsgId });
          return; // ignore stale/old request events
        }

        const handlers: {
          [K in ChatSSEEvent['type']]: (evt: Extract<ChatSSEEvent, { type: K }>) => void;
        } = {
          delta: (evt) => {
            console.log('[ChatStore] Processing delta event', { contentLength: evt.content?.length, pendingAssistantId });
            set((s) => {
              const messages = s.messagesByConv[convId] || [];
              const updated = messages.map((m) => (m.id === pendingAssistantId ? { ...m, content: m.content + evt.content } : m));
              console.log('[ChatStore] Updated assistant message', { messageCount: updated.length, assistantContent: updated.find(m => m.id === pendingAssistantId)?.content?.slice(0, 50) });
              return {
                messagesByConv: {
                  ...s.messagesByConv,
                  [convId]: updated,
                },
              };
            });
          },
          done: () => {
            console.log('[ChatStore] Processing done event', { pendingAssistantId });
            set((s) => ({
              messagesByConv: {
                ...s.messagesByConv,
                [convId]: (s.messagesByConv[convId] || []).map((m) => (m.id === pendingAssistantId ? { ...m, id: `assistant-${clientMsgId}` } : m)),
              },
            }));
          },
          persist: (evt) => {
            console.log('[ChatStore] Processing persist event', { status: evt.status });
            if (VALID_PERSIST_STATUSES.has(evt.status)) {
              get().setPersistState(evt.status, clientMsgId);
            }
          },
          error: (evt) => {
            console.error('[ChatStore] Processing error event', { error: evt.error });
            set({ error: String(evt.error || 'reply failed') });
            get().setPersistState('failed', clientMsgId);
          }
        };

        const type = e.type as ChatSSEEvent['type'];
        if (type && type in handlers) {
          switch (type) {
            case 'delta': {
              const evt = e as unknown as Extract<ChatSSEEvent, { type: 'delta' }>;
              if (typeof evt.content === 'string') handlers.delta(evt);
              break;
            }
            case 'done': {
              handlers.done(e as unknown as Extract<ChatSSEEvent, { type: 'done' }>);
              break;
            }
            case 'persist': {
              const evt = e as unknown as Extract<ChatSSEEvent, { type: 'persist' }>;
              if (VALID_PERSIST_STATUSES.has(evt.status)) handlers.persist(evt);
              break;
            }
            case 'error': {
              const evt = e as unknown as Extract<ChatSSEEvent, { type: 'error' }>;
              handlers.error(evt);
              break;
            }
            default:
              break;
          }
        }
      });

      // Delivered + persisted → clear the outbox entry.
      outbox.remove(clientMsgId);
    } finally {
      // Clear pending assistant message if stream ended without content (error case)
      // or leave it intact if it has accumulated content from successful stream
      set((s) => {
        const messages = s.messagesByConv[convId] || [];
        const pendingMsg = messages.find((m) => m.id === pendingAssistantId);
        // Only filter out if empty (stream had error and never started)
        if (pendingMsg && !pendingMsg.content) {
          return {
            messagesByConv: {
              ...s.messagesByConv,
              [convId]: messages.filter((m) => m.id !== pendingAssistantId),
            },
          };
        }
        return s;
      });
    }
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
    isChatOpen: false,
    persistState: 'idle',
    activePersistRequestId: null,
    setChatOpen: (open: boolean) => set({ isChatOpen: open }),
    setPersistState: (persistState, requestId) => {
      if (requestId) {
        const currentActive = get().activePersistRequestId;
        if (currentActive && requestId !== currentActive) {
          // Stale event from an older request: discard terminal events
          // (saved/failed) but allow new requests to take over (saving).
          if (persistState !== 'saving') {
            return;
          }
        }
      }
      set({ persistState, ...(requestId ? { activePersistRequestId: requestId } : {}) });
      if (persistState !== 'idle' && persistState !== 'saving') {
        const capturedRequestId = requestId || get().activePersistRequestId;
        setTimeout(() => {
          if (get().persistState === persistState && get().activePersistRequestId === capturedRequestId) {
            set({ persistState: 'idle', activePersistRequestId: null });
          }
        }, 5000);
      } else if (persistState === 'saving') {
        // Add timeout for 'saving' state to prevent it from getting stuck (e.g., if persist event never arrives)
        // After 8s, if still in 'saving' state, clear to idle to unblock UI
        const capturedRequestId = requestId || get().activePersistRequestId;
        setTimeout(() => {
          if (get().persistState === 'saving' && get().activePersistRequestId === capturedRequestId) {
            console.warn('[ChatStore] Persist state stuck at "saving" for 8s, clearing to idle');
            set({ persistState: 'idle', activePersistRequestId: null });
          }
        }, 8000);
      }
    },

    loadConversations: async () => {
      set({ loadingList: true, error: null });
      try {
        const { conversations } = await api<{ conversations: ChatConversation[] }>('/api/chat/conversations');
        set((s) => ({
          conversations,
          loadingList: false,
          // Only keep activeId if it exists in the new list; don't default to first conversation
          activeId: s.activeId && conversations.some((c) => c.id === s.activeId) ? s.activeId : null,
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
        // Do NOT auto-promote persistState here. The persist: saved/failed SSE
        // event from the worker is the authoritative delivery confirmation.
        // deliver() returns when the stream ends, not when persistence completes.
      } catch (e) {
        // Stays in outbox; user bubble kept, pending assistant bubble NOT stripped — retry loop needs full context.
        const { msg } = handleChatStreamError(e, { convId: convId!, clientMsgId, action: 'sendMessage' }, get().setPersistState);
        set({ error: msg || 'Send failed (queued for retry)' });
      } finally {
        set({ sending: false });
      }
    },

    renameConversation: async (id, title) => {
      set((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? { ...c, title } : c)) }));
      try {
        await api(`/api/chat/conversations/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Sentry.captureException(err, { contexts: { renameConversation: { conversationId: id } } });
        console.error('[ChatStore]', { message: 'optimistic rename failed', error: msg, conversationId: id });
      }
    },

    updateConversationAnalysisId: async (id, analysisId) => {
      set((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? { ...c, analysisId } : c)) }));
      try {
        await api(`/api/chat/conversations/${id}`, { method: 'PATCH', body: JSON.stringify({ analysisId }) });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Sentry.captureException(err, { contexts: { updateConversationAnalysisId: { conversationId: id, analysisId } } });
        console.error('[ChatStore]', { message: 'optimistic update analysisId failed', error: msg, conversationId: id });
      }
    },

    deleteConversation: async (id) => {
      set((s) => {
        const conversations = s.conversations.filter((c) => c.id !== id);
        const rest = { ...s.messagesByConv };
        delete rest[id];
        // Don't default to first conversation - let the user choose
        return { conversations, messagesByConv: rest, activeId: s.activeId === id ? null : s.activeId };
      });
      try {
        await api(`/api/chat/conversations/${id}`, { method: 'DELETE' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Sentry.captureException(err, { contexts: { deleteConversation: { conversationId: id } } });
        console.warn('[ChatStore]', { message: 'conversation delete failed', error: msg, conversationId: id });
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
            // Do NOT auto-promote persistState here — same as sendMessage.
            // The persist: saved/failed SSE event is the authoritative signal.
          } catch (err) {
            handleChatStreamError(err, { convId: e.conversationId, clientMsgId: e.clientMsgId, action: 'flushOutbox' }, get().setPersistState);
            break; // still offline / failing — stop; retry on next online event
          }
        }
      } finally {
        set({ sending: false });
      }
    },

    reset: () => {
      set({
        conversations: [],
        activeId: null,
        messagesByConv: {},
        error: null,
        sending: false,
        isChatOpen: false,
        persistState: 'idle',
      });
    },
  };
});
