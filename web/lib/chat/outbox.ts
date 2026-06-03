/**
 * Offline outbox — durable client-side queue for unsent chat messages.
 *
 * The network may be down (so neither Postgres nor Redis/QStash are reachable); the
 * queue therefore lives on the client. Each entry carries a client idempotency key,
 * so replaying on reconnect can never double-insert (server dedupes on client_msg_id).
 *
 * localStorage is used (synchronous, simple, fine for small text queues). Swap for
 * IndexedDB if volume/size ever warrants it — the interface stays the same.
 */

export interface OutboxEntry {
  clientMsgId: string;
  conversationId: string;
  content: string;
  createdAt: string;
}

const KEY = 'hx-chat-outbox';

function read(): OutboxEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: OutboxEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* quota / privacy mode — best effort */
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
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
