'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';
import { useChatStore } from '@/store/useChatStore';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface ChatDockProps {
  /** Active analysis for grounding new threads (optional). */
  analysisId?: string | null;
  analysisTitle?: string;
}

const OPEN_KEY = 'hx-chatdock-open';
const BAR_H = 46;

/**
 * Bottom-docked, vertically-collapsible chat sheet. Rendered into DashboardLayout's
 * `dock` slot, so it spans the MAIN COLUMN (between the left sidebar and the right
 * rail) and never covers the panels. Collapsed = a slim bar; expanded = a sheet that
 * grows UPWARD. Durable threads via useChatStore → /api/chat → Postgres; survives all
 * navigation because the layout (and this dock) stay mounted.
 */
export function ChatDock({ analysisId, analysisTitle }: ChatDockProps) {
  const {
    conversations, activeId, messagesByConv, sending,
    loadConversations, selectConversation, newConversation, sendMessage, deleteConversation, bindNetwork,
  } = useChatStore();

  const [open, setOpen] = useState(false);
  const [showThreads, setShowThreads] = useState(false);
  const [input, setInput] = useState('');

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = useMemo(() => (activeId ? messagesByConv[activeId] || [] : []), [activeId, messagesByConv]);
  const activeConv = useMemo(() => conversations.find((c) => c.id === activeId) || null, [conversations, activeId]);

  useEffect(() => { bindNetwork(); }, [bindNetwork]);

  useEffect(() => {
    try { if (localStorage.getItem(OPEN_KEY) === '1') setOpen(true); } catch { /* noop */ }
  }, []);

  useEffect(() => {
    try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* noop */ }
    if (open) {
      void loadConversations();
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setShowThreads(false);
    }
  }, [open, loadConversations]);

  useEffect(() => {
    if (open && activeId) void selectConversation(activeId);
  }, [open, activeId, selectConversation]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    // Only autoscroll if the user is already near the bottom — don't yank them down
    // when they've scrolled up to read earlier messages.
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, sending, open]);

  // Reset to new conversation whenever the analysis changes — prevents stale context bleeds.
  useEffect(() => {
    if (!open || !analysisId) return;
    let cancelled = false;
    void (async () => {
      await newConversation({ analysisId });
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (cancelled) return;
        const el = listRef.current;
        if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
      });
    })();
    return () => { cancelled = true; };
  }, [analysisId, open, newConversation]);

  const scrollToBottom = () => {
    const el = listRef.current;
    if (el) requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
  };

  const submit = async (text: string) => {
    const t = text.trim();
    if (!t || sending) return;
    setInput('');
    scrollToBottom(); // user just sent — always follow to the bottom
    await sendMessage(t, { analysisId: analysisId ?? null });
  };

  const handleSend = () => submit(input);

  const handleNew = async () => {
    setShowThreads(false);
    await newConversation({ analysisId: null });
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  // Shared shell: absolute, anchored to the bottom of <main>, full width of the column.
  const shell: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 'var(--z-dock)' as any,
    borderTop: '1px solid var(--line)',
    background: 'rgb(11 14 20 / 0.97)',
    backdropFilter: 'blur(12px)',
  };

  // --- Collapsed: slim bar -------------------------------------------------
  if (!open) {
    return (
      <div style={{ ...shell, height: BAR_H, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 10 }}>
        <button
          onClick={() => setOpen(true)}
          aria-label="Open chat"
          style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, background: 'transparent', border: 'none', color: 'var(--ink-secondary)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12.5, height: '100%' }}
        >
          <Icon icon="solar:chat-round-dots-bold" size={17} style={{ color: 'var(--accent-ink)' }} />
          <span style={{ fontWeight: 600, color: 'var(--ink)' }}>Synthesis Chat</span>
          <span style={{ color: 'var(--ink-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeConv ? `· ${activeConv.title}` : analysisTitle ? `· ask about “${analysisTitle.slice(0, 40)}”` : '· ask anything'}
          </span>
        </button>
        <button onClick={() => setOpen(true)} aria-label="Expand chat" title="Expand" style={iconBtn}>
          <Icon icon="solar:alt-arrow-up-linear" size={16} />
        </button>
      </div>
    );
  }

  // --- Expanded: bottom sheet growing upward -------------------------------
  return (
    <div
      role="dialog"
      aria-label="Synthesis chat"
      style={{ ...shell, height: 'min(60vh, 560px)', display: 'flex', flexDirection: 'column' }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 14px', borderBottom: '1px solid var(--line)', background: 'rgb(26 31 43 / 0.6)' }}>
        <button
          onClick={() => setShowThreads((v) => !v)}
          title="Switch thread"
          style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, background: 'transparent', border: 'none', color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 600 }}
        >
          <Icon icon="solar:chat-round-dots-linear" size={16} style={{ color: 'var(--accent-ink)', flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 360 }}>{activeConv?.title || 'New chat'}</span>
          <Icon icon="solar:alt-arrow-down-linear" size={13} style={{ color: 'var(--ink-muted)', flexShrink: 0 }} />
        </button>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={handleNew} title="New chat" style={iconBtn}><Icon icon="solar:pen-new-square-linear" size={14} /></button>
          <button onClick={() => setOpen(false)} aria-label="Collapse chat" title="Collapse" style={iconBtn}><Icon icon="solar:alt-arrow-down-linear" size={16} /></button>
        </div>
      </div>

      {/* Thread switcher */}
      {showThreads && (
        <div style={{ maxHeight: 200, overflowY: 'auto', borderBottom: '1px solid var(--line)', background: 'rgb(8 11 17 / 0.8)' }}>
          {conversations.length === 0 && <div style={{ padding: 12, color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>No conversations yet</div>}
          {conversations.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 8px' }}>
              <button
                onClick={() => { void selectConversation(c.id); setShowThreads(false); }}
                style={{
                  flex: 1, minWidth: 0, textAlign: 'left', padding: '8px', borderRadius: 8, border: 'none', cursor: 'pointer',
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

      {/* Messages — centered column for readable line length */}
      <div ref={listRef} aria-live="polite" style={{ flex: 1, overflowY: 'auto', padding: '16px 0' }}>
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.length === 0 && !sending && (
            <div style={{ margin: '24px auto', textAlign: 'center', color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6 }}>
              <Icon icon="solar:chat-square-like-linear" size={28} style={{ color: 'var(--ink-muted)', marginBottom: 8 }} />
              <div>{analysisTitle ? `Ask about “${analysisTitle.slice(0, 48)}”` : 'Ask anything —'}</div>
              <div>this thread is saved to your history.</div>
            </div>
          )}
          {messages.map((m) => {
            const { body, options } = m.role === 'assistant' ? parseAssistant(m.content) : { body: m.content, options: [] as string[] };
            const isUser = m.role === 'user';
            return (
              <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', gap: 6 }}>
                <div 
                  className={isUser ? "" : "prose prose-invert max-w-none prose-p:text-xs prose-p:leading-relaxed prose-headings:text-sm prose-headings:mt-2 prose-headings:mb-1"}
                  style={{
                    maxWidth: '80%', padding: '9px 13px', borderRadius: 12, fontSize: 13.5, lineHeight: 1.55,
                    background: isUser ? 'var(--accent)' : 'rgb(26 31 43 / 0.85)',
                    color: isUser ? 'var(--void)' : 'var(--ink-secondary)',
                    border: isUser ? 'none' : '1px solid var(--line)',
                    borderBottomRightRadius: isUser ? 4 : 12, borderBottomLeftRadius: isUser ? 12 : 4,
                    whiteSpace: isUser ? 'pre-wrap' : 'normal', wordBreak: 'break-word',
                  }}
                >
                  {isUser ? (
                    body
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {body}
                    </ReactMarkdown>
                  )}
                </div>
                {!isUser && body && (
                  <div style={{ display: 'flex', gap: 6, marginLeft: 2 }}>
                    <button onClick={() => navigator.clipboard?.writeText(body).catch(() => {})} title="Copy" style={turnIconBtn}>
                      <Icon icon="solar:copy-linear" size={13} />
                    </button>
                  </div>
                )}
                {!isUser && options.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: '92%' }}>
                    {options.map((opt, i) => (
                      <button key={i} onClick={() => void submit(opt)} disabled={sending}
                        style={{
                          padding: '6px 11px', borderRadius: 9999, border: '1px solid var(--accent)',
                          background: 'rgb(6 182 212 / 0.10)', color: 'var(--accent-ink)', cursor: sending ? 'not-allowed' : 'pointer',
                          fontFamily: 'var(--font-mono)', fontSize: 11.5, textAlign: 'left',
                        }}>
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {sending && (
            <div style={{ display: 'flex', gap: 5, padding: '9px 13px', alignSelf: 'flex-start' }}>
              {[0, 1, 2].map((i) => (
                <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ink-muted)', animation: `hx-pulse 1.2s ease-in-out ${i * 0.18}s infinite` }} />
              ))}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Composer */}
      <div style={{ borderTop: '1px solid var(--line)', padding: 12 }}>
        <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Message… (Enter to send, Shift+Enter for newline)"
            style={{
              flex: 1, resize: 'none', maxHeight: 140, padding: '10px 12px', borderRadius: 10,
              border: '1px solid var(--line)', background: 'rgb(8 11 17 / 0.8)', color: 'var(--ink)',
              fontFamily: 'inherit', fontSize: 13.5, lineHeight: 1.5, outline: 'none',
            }}
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() || sending}
            aria-label="Send message"
            style={{
              flexShrink: 0, width: 40, height: 40, borderRadius: 10, border: 'none', display: 'grid', placeItems: 'center',
              cursor: !input.trim() || sending ? 'not-allowed' : 'pointer',
              background: !input.trim() || sending ? 'rgb(51 65 85 / 0.5)' : 'var(--accent)', color: 'var(--void)',
            }}
          >
            <Icon icon="solar:arrow-up-linear" size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 7,
  border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink-muted)', cursor: 'pointer',
};

const turnIconBtn: React.CSSProperties = {
  display: 'grid', placeItems: 'center', width: 24, height: 24, borderRadius: 6,
  border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink-muted)', cursor: 'pointer',
};

/** Split an assistant reply into its body and the trailing OPTIONS chips. */
function parseAssistant(content: string): { body: string; options: string[] } {
  const m = content.match(/OPTIONS:\s*(\[[\s\S]*\])\s*$/);
  if (!m || m.index === undefined) return { body: content.trim(), options: [] };
  let options: string[] = [];
  try {
    const arr = JSON.parse(m[1] ?? '[]');
    if (Array.isArray(arr)) options = arr.filter((x) => typeof x === 'string').slice(0, 4);
  } catch {
    /* malformed / still streaming */
  }
  const body = content.slice(0, m.index).trim();
  return { body: body || content.trim(), options };
}
