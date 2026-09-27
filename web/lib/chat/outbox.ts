/**
 * Offline outbox — durable client-side queue for unsent chat messages.
 *
 * The network may be down (so neither Postgres nor Redis/QStash are reachable); the
 * queue therefore lives on the client. Each entry carries a client idempotency key,
 * so replaying on reconnect can never double-insert (server dedupes on client_msg_id).
 *
 * localStorage is used (synchronous, simple, fine for small text queues) via the
 * safe-storage shim (Android WebView SecurityError / null localStorage). Swap for
 * IndexedDB if volume/size ever warrants it — the interface stays the same.
 */

import { safeLocalStorage } from '@/lib/utils/safe-storage';

export interface OutboxEntry {
  clientMsgId: string;
  conversationId: string;
  content: string;
  createdAt: string;
}

const OUTBOX_STORAGE_NAME = 'hx-chat-outbox';

function read(): OutboxEntry[] {
  try {
    const raw = safeLocalStorage.getItem(OUTBOX_STORAGE_NAME);
    return raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
  } catch (err) {
    console.warn('[outbox] failed to read entries:', err);
    return [];
  }
}

function write(entries: OutboxEntry[]): void {
  try {
    safeLocalStorage.setItem(OUTBOX_STORAGE_NAME, JSON.stringify(entries));
  } catch (err) {
    console.warn('[outbox] failed to persist entry (quota exceeded or private mode)', err);
  }
}

export const outbox = {
  all: read,

  add(entry: OutboxEntry): void {
    const entries = read();
    if (entries.some((e) => e.clientMsgId === entry.clientMsgId)) return;
    entries.push(entry);
    write(entries);
  },

  remove(clientMsgId: string): void {
    write(read().filter((e) => e.clientMsgId !== clientMsgId));
  },

  forConversation(conversationId: string): OutboxEntry[] {
    return read().filter((e) => e.conversationId === conversationId);
  },

  isEmpty(): boolean {
    return read().length === 0;
  },
};

export function newClientMsgId(): string {
  try {
    return crypto.randomUUID();
  } catch (err) {
    console.warn('[outbox] randomUUID failed, falling back to secure random values:', err);
    try {
      const bytes = new Uint8Array(6);
      crypto.getRandomValues(bytes);
      const suffix = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      return `${Date.now()}-${suffix}`;
    } catch (cryptoErr) {
      console.warn('[outbox] getRandomValues failed, falling back to timestamp suffix:', cryptoErr);
      return `${Date.now()}-${Date.now().toString(36)}`;
    }
  }
}
