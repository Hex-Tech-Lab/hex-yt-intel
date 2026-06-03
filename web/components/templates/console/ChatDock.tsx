'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

export interface ChatDockProps {
  /** Grounding context for the assistant (current analysis). */
  context?: { title?: string; videoId?: string };
}

const OPEN_KEY = 'hx-chatdock-open';

/**
 * Persistent, collapsible chat dock (bottom-right). Self-contained UI shell:
 * messages live in local state so the dock survives tab switches (it is mounted
 * once, outside the nav switch). The network turn is isolated in `respond()` —
 * swap the placeholder for a `/api/chat` SSE call when the backend lands.
 */
export function ChatDock({ context }: ChatDockProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [unread, setUnread] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Restore persisted open state.
  useEffect(() => {
    try {
      if (localStorage.getItem(OPEN_KEY) === '1') setOpen(true);
    } catch {
      /* SSR / privacy mode */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, open ? '1' : '0');
    } catch {
      /* noop */
    }
    if (open) {
      setUnread(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Autoscroll on new messages / typing.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, thinking]);

  const push = useCallback((role: ChatMessage['role'], content: string) => {
    setMessages((m) => [...m, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role, content, ts: Date.now() }]);
  }, []);

  // --- The one network seam. Replace body with a streaming /api/chat call. ---
  const respond = useCallback(
    async (_userText: string) => {
      setThinking(true);
      await new Promise((r) => setTimeout(r, 500));
      const grounding = context?.title ? ` about “${context.title}”` : '';
      push(
        'assistant',
        `Chat isn't wired to a model yet — this dock is ready for the \`/api/chat\` endpoint. ` +
          `Once connected, I'll answer questions${grounding} grounded in the synthesized dimensions and the knowledge graph.`
      );
      setThinking(false);
      if (!open) setUnread(true);
    },
    [context, open, push]
  );

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || thinking) return;
    push('user', text);
    setInput('');
    void respond(text);
  }, [input, thinking, push, respond]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  // Collapsed pill.
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open chat"
        style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 1000,
          display: 'flex', alignItems: 'center', gap: 9, padding: '11px 16px',
          borderRadius: 9999, border: '1px solid var(--line)',
          background: 'var(--accent)', color: 'var(--void)',
          boxShadow: '0 8px 28px rgb(6 182 212 / 0.28)', cursor: 'pointer',
          fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 700,
        }}
      >
        <Icon icon="solar:chat-round-dots-bold" size={18} />
        Ask the synthesis
        {unread && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--err)' }} />}
      </button>
    );
  }

  // Expanded panel.
  return (
    <div
      role="dialog"
      aria-label="Synthesis chat"
      style={{
        position: 'fixed', bottom: 20, right: 20, zIndex: 1000,
        width: 'min(400px, calc(100vw - 40px))', height: 'min(520px, calc(100vh - 96px))',
        display: 'flex', flexDirection: 'column',
        borderRadius: 16, overflow: 'hidden', border: '1px solid var(--line)',
        background: 'rgb(11 14 20 / 0.96)', backdropFilter: 'blur(12px)',
        boxShadow: '0 20px 60px rgb(0 0 0 / 0.5)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderBottom: '1px solid var(--line)', background: 'rgb(26 31 43 / 0.6)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink)', fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 600 }}>
          <Icon icon="solar:chat-round-dots-linear" size={16} style={{ color: 'var(--accent-ink)' }} />
          Synthesis Chat
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {messages.length > 0 && (
            <button onClick={() => setMessages([])} title="Clear" style={iconBtn}>
              <Icon icon="solar:trash-bin-trash-linear" size={14} />
            </button>
          )}
          <button onClick={() => setOpen(false)} aria-label="Collapse chat" title="Collapse" style={iconBtn}>
            <Icon icon="solar:minimize-square-linear" size={14} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={listRef} aria-live="polite" style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && !thinking && (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6 }}>
            <Icon icon="solar:chat-square-like-linear" size={28} style={{ color: 'var(--ink-muted)', marginBottom: 8 }} />
            <div>Ask anything about this analysis —</div>
            <div>dimensions, relations, contrarian takes.</div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div
              style={{
                maxWidth: '82%', padding: '9px 12px', borderRadius: 12, fontSize: 13, lineHeight: 1.55,
                background: m.role === 'user' ? 'var(--accent)' : 'rgb(26 31 43 / 0.8)',
                color: m.role === 'user' ? 'var(--void)' : 'var(--ink-secondary)',
                border: m.role === 'user' ? 'none' : '1px solid var(--line)',
                borderBottomRightRadius: m.role === 'user' ? 4 : 12,
                borderBottomLeftRadius: m.role === 'user' ? 12 : 4,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}
            >
              {m.content}
            </div>
          </div>
        ))}
        {thinking && (
          <div style={{ display: 'flex', gap: 5, padding: '9px 12px', alignSelf: 'flex-start', color: 'var(--ink-muted)' }}>
            {[0, 1, 2].map((i) => (
              <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ink-muted)', animation: `hx-pulse 1.2s ease-in-out ${i * 0.18}s infinite` }} />
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <div style={{ borderTop: '1px solid var(--line)', padding: 10, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Message… (Enter to send, Shift+Enter for newline)"
          style={{
            flex: 1, resize: 'none', maxHeight: 120, padding: '9px 11px', borderRadius: 10,
            border: '1px solid var(--line)', background: 'rgb(8 11 17 / 0.8)', color: 'var(--ink)',
            fontFamily: 'var(--font-sans, inherit)', fontSize: 13, lineHeight: 1.5, outline: 'none',
          }}
        />
        <button
          onClick={send}
          disabled={!input.trim() || thinking}
          aria-label="Send message"
          style={{
            flexShrink: 0, width: 38, height: 38, borderRadius: 10, border: 'none',
            display: 'grid', placeItems: 'center', cursor: !input.trim() || thinking ? 'not-allowed' : 'pointer',
            background: !input.trim() || thinking ? 'rgb(51 65 85 / 0.5)' : 'var(--accent)',
            color: 'var(--void)', transition: 'background 0.15s',
          }}
        >
          <Icon icon="solar:arrow-up-linear" size={18} />
        </button>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 7,
  border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink-muted)', cursor: 'pointer',
};
