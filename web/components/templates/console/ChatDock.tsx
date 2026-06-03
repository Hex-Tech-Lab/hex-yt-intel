'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';
import { useChatStore } from '@/store/useChatStore';

export interface ChatDockProps {
  /** Active analysis for grounding new threads (optional). */
  analysisId?: string | null;
  analysisTitle?: string;
}

const OPEN_KEY = 'hx-chatdock-open';

/**
 * Persistent, collapsible chat dock backed by durable threads (useChatStore →
 * /api/chat → Postgres). Mounted once at layout level, so it survives every nav /
 * window / UI change. Start a new thread any time and ask anything; threads live in
 * history and are optionally grounded in the active analysis.
 */
export function ChatDock({ analysisId, analysisTitle }: ChatDockProps) {
  const {
    conversations, activeId, messagesByConv, sending,
    loadConversations, selectConversation, newConversation, sendMessage, deleteConversation,
  } = useChatStore();

  const [open, setOpen] = useState(false);
  const [showThreads, setShowThreads] = useState(false);
  const [input, setInput] = useState('');

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const messages = useMemo(() => (activeId ? messagesByConv[activeId] || [] : []), [activeId, messagesByConv]);
  const activeConv = useMemo(() => conversations.find((c) => c.id === activeId) || null, [conversations, activeId]);

  // Restore persisted open state.
  useEffect(() => {
    try {
      if (localStorage.getItem(OPEN_KEY) === '1') setOpen(true);
    } catch {
      /* noop */
    }
  }, []);

  // On open: hydrate threads, focus composer.
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, open ? '1' : '0');
    } catch {
      /* noop */
    }
    if (open) {
      void loadConversations();
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, loadConversations]);

  // Hydrate the active thread's messages when it changes.
  useEffect(() => {
    if (open && activeId) void selectConversation(activeId);
  }, [open, activeId, selectConversation]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    // Lazily create a thread grounded in the current analysis if none is active.
    if (!activeId) await newConversation({ analysisId: analysisId ?? null });
    setInput('');
    await sendMessage(text);
  };

  const handleNew = async () => {
    setShowThreads(false);
    // Explicit "+" starts a fresh GENERAL thread (ask anything, unrelated is fine).
    await newConversation({ analysisId: null });
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open chat"
        style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 1000,
          display: 'flex', alignItems: 'center', gap: 9, padding: '11px 16px',
          borderRadius: 9999, border: '1px solid var(--line)', background: 'var(--accent)', color: 'var(--void)',
          boxShadow: '0 8px 28px rgb(6 182 212 / 0.28)', cursor: 'pointer',
          fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 700,
        }}
      >
        <Icon icon="solar:chat-round-dots-bold" size={18} />
        Ask the synthesis
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Synthesis chat"
      style={{
        position: 'fixed', bottom: 20, right: 20, zIndex: 1000,
        width: 'min(400px, calc(100vw - 40px))', height: 'min(540px, calc(100vh - 96px))',
        display: 'flex', flexDirection: 'column', borderRadius: 16, overflow: 'hidden',
        border: '1px solid var(--line)', background: 'rgb(11 14 20 / 0.96)', backdropFilter: 'blur(12px)',
        boxShadow: '0 20px 60px rgb(0 0 0 / 0.5)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid var(--line)', background: 'rgb(26 31 43 / 0.6)' }}>
        <button
          onClick={() => setShowThreads((v) => !v)}
          title="Switch thread"
          style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, background: 'transparent', border: 'none', color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 600 }}
        >
          <Icon icon="solar:chat-round-dots-linear" size={16} style={{ color: 'var(--accent-ink)', flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
            {activeConv?.title || 'New chat'}
          </span>
          <Icon icon="solar:alt-arrow-down-linear" size={13} style={{ color: 'var(--ink-muted)', flexShrink: 0 }} />
        </button>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={handleNew} title="New chat" style={iconBtn}><Icon icon="solar:pen-new-square-linear" size={14} /></button>
          <button onClick={() => setOpen(false)} aria-label="Collapse chat" title="Collapse" style={iconBtn}><Icon icon="solar:minimize-square-linear" size={14} /></button>
        </div>
      </div>

      {/* Thread switcher (history) */}
      {showThreads && (
        <div style={{ maxHeight: 200, overflowY: 'auto', borderBottom: '1px solid var(--line)', background: 'rgb(8 11 17 / 0.7)' }}>
          {conversations.length === 0 && <div style={{ padding: 12, color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>No conversations yet</div>}
          {conversations.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 6px' }}>
              <button
                onClick={() => { void selectConversation(c.id); setShowThreads(false); }}
                style={{
                  flex: 1, minWidth: 0, textAlign: 'left', padding: '8px 8px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: c.id === activeId ? 'rgb(6 182 212 / 0.12)' : 'transparent',
                  color: c.id === activeId ? 'var(--accent-ink)' : 'var(--ink-secondary)',
                  fontFamily: 'var(--font-mono)', fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  display: 'flex', alignItems: 'center', gap: 7,
                }}
              >
                {c.analysisId && <Icon icon="solar:link-round-angle-linear" size={12} style={{ flexShrink: 0, opacity: 0.7 }} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</span>
              </button>
              <button onClick={() => void deleteConversation(c.id)} title="Delete" style={{ ...iconBtn, width: 22, height: 22 }}><Icon icon="solar:trash-bin-minimalistic-linear" size={12} /></button>
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      <div ref={listRef} aria-live="polite" style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && !sending && (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6 }}>
            <Icon icon="solar:chat-square-like-linear" size={28} style={{ color: 'var(--ink-muted)', marginBottom: 8 }} />
            <div>{analysisTitle ? `Ask about “${analysisTitle.slice(0, 40)}”` : 'Ask anything —'}</div>
            <div>this thread is saved to your history.</div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '82%', padding: '9px 12px', borderRadius: 12, fontSize: 13, lineHeight: 1.55,
              background: m.role === 'user' ? 'var(--accent)' : 'rgb(26 31 43 / 0.8)',
              color: m.role === 'user' ? 'var(--void)' : 'var(--ink-secondary)',
              border: m.role === 'user' ? 'none' : '1px solid var(--line)',
              borderBottomRightRadius: m.role === 'user' ? 4 : 12, borderBottomLeftRadius: m.role === 'user' ? 12 : 4,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div style={{ display: 'flex', gap: 5, padding: '9px 12px', alignSelf: 'flex-start' }}>
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
            fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5, outline: 'none',
          }}
        />
        <button
          onClick={() => void handleSend()}
          disabled={!input.trim() || sending}
          aria-label="Send message"
          style={{
            flexShrink: 0, width: 38, height: 38, borderRadius: 10, border: 'none', display: 'grid', placeItems: 'center',
            cursor: !input.trim() || sending ? 'not-allowed' : 'pointer',
            background: !input.trim() || sending ? 'rgb(51 65 85 / 0.5)' : 'var(--accent)', color: 'var(--void)',
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
