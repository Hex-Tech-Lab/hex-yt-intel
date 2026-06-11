'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';
import { useChatStore } from '@/store/useChatStore';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { ProcessingLog } from './ProcessingLog';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useInputStore } from '@/store/useInputStore';
import { extractVideoId } from '@/lib/youtube';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';

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
  const analysisStore = useAnalysisStore();
  const { url } = useInputStore();
  const nucleusAnalysis = useSynthesisNucleus((state) => state.analysis);

  const logStatus = analysisStore.status;
  const showLog = logStatus !== 'idle' && analysisStore.terminalLines.length > 0;

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
    if (!url) {
      const state = useChatStore.getState();
      const activeConv = state.conversations.find((c) => c.id === state.activeId);
      if (activeConv && activeConv.analysisId) {
        const generalConv = state.conversations.find((c) => !c.analysisId);
        if (generalConv) {
          void selectConversation(generalConv.id);
        } else {
          useChatStore.setState({ activeId: null });
        }
      }
      return;
    }

    const inputVideoId = extractVideoId(url);
    const loadedVideoId = nucleusAnalysis?.videoId || null;

    if (inputVideoId !== loadedVideoId) {
      const state = useChatStore.getState();
      const activeConv = state.conversations.find((c) => c.id === state.activeId);
      if (activeConv && activeConv.analysisId) {
        const generalConv = state.conversations.find((c) => !c.analysisId);
        if (generalConv) {
          void selectConversation(generalConv.id);
        } else {
          useChatStore.setState({ activeId: null });
        }
      }
    }
  }, [url, nucleusAnalysis?.videoId, selectConversation]);

  useEffect(() => {
    try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* noop */ }
    if (!open) {
      setShowThreads(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      await loadConversations();
      if (cancelled) return;
      requestAnimationFrame(() => inputRef.current?.focus());

      if (analysisId) {
        const state = useChatStore.getState();
        const existing = state.conversations.find((c) => c.analysisId === analysisId);
        if (existing) {
          if (state.activeId !== existing.id) {
            await selectConversation(existing.id);
          }
        } else {
          await newConversation({ analysisId });
        }
      } else {
        const state = useChatStore.getState();
        const activeConv = state.conversations.find((c) => c.id === state.activeId);
        if (activeConv && activeConv.analysisId) {
          // If current conversation is bound to a video but analysis is now null,
          // switch to a general conversation (where analysisId is null/falsy) or deselect.
          const generalConv = state.conversations.find((c) => !c.analysisId);
          if (generalConv) {
            await selectConversation(generalConv.id);
          } else {
            useChatStore.setState({ activeId: null });
          }
        }
      }
      
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (cancelled) return;
        const el = listRef.current;
        if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [open, analysisId, loadConversations, selectConversation, newConversation]);

  useEffect(() => {
    if (open && activeId) void selectConversation(activeId);
  }, [open, activeId, selectConversation]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, sending, open]);

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
        {showLog && (
          <div style={{ position: 'absolute', bottom: 'calc(100% + 1px)', left: 0, right: 0, zIndex: 100 }}>
            <ProcessingLog status={logStatus === 'analyzing' || logStatus === 'downloading' ? 'streaming' : logStatus === 'complete' ? 'done' : logStatus === 'error' ? 'error' : 'idle'} />
          </div>
        )}
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
      {showLog && (
        <div style={{ position: 'absolute', bottom: 'calc(100% + 1px)', left: 0, right: 0, zIndex: 100 }}>
          <ProcessingLog status={logStatus === 'analyzing' || logStatus === 'downloading' ? 'streaming' : logStatus === 'complete' ? 'done' : logStatus === 'error' ? 'error' : 'idle'} />
        </div>
      )}
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
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        ul: ({ children }) => <ul className="list-disc list-outside pl-7 my-3 space-y-1.5 ml-1">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal list-outside pl-7 my-3 space-y-1.5 ml-1">{children}</ol>,
                        li: ({ children }) => <li className="text-[12px] leading-relaxed text-[var(--ink-secondary)] pl-0.5">{renderChildren(children)}</li>,
                        p: ({ children }) => <p className="text-[12px] leading-relaxed mb-3.5 mt-1.5 text-[var(--ink-secondary)] last:mb-0">{renderChildren(children)}</p>,
                        code: ({ className, children }) => {
                          const codeText = String(children).replace(/\n$/, '');
                          const hasNewline = codeText.includes('\n');
                          const isInline = !hasNewline && !className?.includes('language-');

                          if (isInline) {
                            return (
                              <code className="bg-slate-800/80 px-1.5 py-0.5 rounded font-mono text-[11px] text-[var(--ink-secondary)]">
                                {parseAnsiToReact(codeText)}
                              </code>
                            );
                          }

                          return (
                            <pre className="bg-slate-900/60 p-3 rounded-lg border border-[var(--line-faint)] overflow-x-auto my-3 font-mono text-[11px] leading-relaxed text-[var(--ink-secondary)]">
                              <code>{parseAnsiToReact(codeText)}</code>
                            </pre>
                          );
                        },
                        table: ({ children }) => (
                          <div className="overflow-x-auto mt-4 mb-6 rounded-xl border border-[var(--line-faint)] bg-[var(--bg)]/30">
                            <table className="min-w-full divide-y divide-[var(--line-faint)] text-[11px] text-[var(--ink-secondary)]">{children}</table>
                          </div>
                        ),
                        thead: ({ children }) => <thead className="bg-[var(--bg)]/50">{children}</thead>,
                        tbody: ({ children }) => <tbody className="divide-y divide-[var(--line-faint)]/50">{children}</tbody>,
                        tr: ({ children }) => <tr>{children}</tr>,
                        th: ({ children }) => <th className="px-4 py-2.5 text-left font-mono font-bold uppercase tracking-wider text-[var(--ink-muted)] border-r border-[var(--line-faint)] last:border-r-0">{renderChildren(children)}</th>,
                        td: ({ children }) => <td className="px-4 py-2.5 border-r border-[var(--line-faint)] last:border-r-0 whitespace-pre-wrap">{renderChildren(children)}</td>,
                      }}
                    >
                      {preprocessMarkdown(body)}
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

const renderChildren = (children: React.ReactNode) => {
  if (typeof children === 'string') {
    return parseAnsiToReact(children);
  }
  return children;
};

/**
 * Preprocesses markdown content from the assistant to convert non-standard elements:
 * 1. Convert unicode bullets (•/●) into standard markdown list items (-).
 * 2. Translate tab-separated values into markdown pipe tables.
 */
function preprocessMarkdown(content: string): string {
  if (!content) return '';

  let processed = content;

  // 1. Convert unicode bullet points at the start of a line or after tab/pipe
  processed = processed.replace(/^[ \t]*[•●]\s*/gm, '- ');
  processed = processed.replace(/\t[ \t]*[•●]\s*/g, '\t- ');
  processed = processed.replace(/\|[ \t]*[•●]\s*/g, '| - ');

  // 2. Detect and transform tab-separated lines into pipe-separated tables
  const lines = processed.split('\n');
  let inTable = false;
  let tableHeaderIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.includes('\t')) {
      const parts = line.split('\t').map((p) => p.trim());
      lines[i] = '| ' + parts.join(' | ') + ' |';

      if (!inTable) {
        inTable = true;
        tableHeaderIndex = i;
      }
    } else {
      if (inTable && tableHeaderIndex !== -1) {
        // Exited tab table: insert the separator line right after the header
        const headerLine = lines[tableHeaderIndex]!;
        const colCount = headerLine.split('|').length - 2;
        if (colCount > 0) {
          const sep = '| ' + Array(colCount).fill('---').join(' | ') + ' |';
          lines.splice(tableHeaderIndex + 1, 0, sep);
          i++; // adjust index for added separator
        }
        inTable = false;
        tableHeaderIndex = -1;
      }
    }
  }

  // Handle table ending at the end of the content
  if (inTable && tableHeaderIndex !== -1) {
    const headerLine = lines[tableHeaderIndex]!;
    const colCount = headerLine.split('|').length - 2;
    if (colCount > 0) {
      const sep = '| ' + Array(colCount).fill('---').join(' | ') + ' |';
      lines.splice(tableHeaderIndex + 1, 0, sep);
    }
  }

  return lines.join('\n');
}

/**
 * Parses ANSI escape codes (colors/formatting) in text and outputs React elements.
 */
function parseAnsiToReact(text: string): React.ReactNode[] | string {
  if (typeof text !== 'string') return text;
  
  // Matches actual ESC sequence or literal escapes like \x1b, \u001b, \033
  const ansiRegex = /(?:\\x1b|\\u001b|\\033|[\u001b])\[([0-9;]*)m/g;

  if (!ansiRegex.test(text)) {
    return text;
  }

  ansiRegex.lastIndex = 0;

  const result: React.ReactNode[] = [];
  let lastIndex = 0;
  let currentStyle: React.CSSProperties = {};
  let match;

  while ((match = ansiRegex.exec(text)) !== null) {
    const textSegment = text.slice(lastIndex, match.index);
    if (textSegment) {
      if (Object.keys(currentStyle).length > 0) {
        result.push(
          <span key={lastIndex} style={{ ...currentStyle }}>
            {textSegment}
          </span>
        );
      } else {
        result.push(textSegment);
      }
    }

    const code = match[1] || '0';
    if (code === '0') {
      currentStyle = {};
    } else {
      const styles = code.split(';');
      for (const s of styles) {
        switch (s) {
          case '30': currentStyle.color = '#000000'; break;
          case '31': currentStyle.color = '#ef4444'; break; // red-500
          case '32': currentStyle.color = '#22c55e'; break; // green-500
          case '33': currentStyle.color = '#eab308'; break; // yellow-500
          case '34': currentStyle.color = '#3b82f6'; break; // blue-500
          case '35': currentStyle.color = '#a855f7'; break; // purple-500
          case '36': currentStyle.color = '#06b6d4'; break; // cyan-500
          case '37': currentStyle.color = '#ffffff'; break;
          case '90': currentStyle.color = '#6b7280'; break; // gray-500
          case '1': currentStyle.fontWeight = 'bold'; break;
          case '4': currentStyle.textDecoration = 'underline'; break;
        }
      }
    }
    lastIndex = ansiRegex.lastIndex;
  }

  const remainingText = text.slice(lastIndex);
  if (remainingText) {
    if (Object.keys(currentStyle).length > 0) {
      result.push(
        <span key={lastIndex} style={{ ...currentStyle }}>
          {remainingText}
        </span>
      );
    } else {
      result.push(remainingText);
    }
  }

  return result;
}
