'use client';

import { useEffect, useMemo, useRef, useState, startTransition, useTransition } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';
import { useChatStore } from '@/store/useChatStore';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { preprocessMarkdown, parseAnsiToReact } from '@/lib/utils/format';
import { generateFollowupPrompts } from '@/lib/utils/generate-followup-prompts';

export interface ChatDockProps {
  /** Active analysis for grounding new threads (optional). */
  analysisId?: string | null;
  analysisTitle?: string;
}

const OPEN_KEY = 'hx-chatdock-open';

/**
 * Bottom-docked, vertically-collapsible chat sheet. Rendered into DashboardLayout's
 * `dock` slot, so it spans the MAIN COLUMN (between the left sidebar and the right
 * rail) and never covers the panels. Collapsed = a slim bar; expanded = a sheet that
 * grows UPWARD. Durable threads via useChatStore → /api/chat → Postgres; survives all
 * navigation because the layout (and this dock) stay mounted.
 */
export function ChatDock({ analysisId, analysisTitle }: ChatDockProps) {
  const {
    conversations, activeId, messagesByConv, sending, persistState,
    loadConversations, selectConversation, newConversation, sendMessage, deleteConversation, bindNetwork,
    isChatOpen: open, setChatOpen: setOpen,
  } = useChatStore();
  const [showThreads, setShowThreads] = useState(false);
  const videoId = useAnalysisStore((s) => s.videoMetadata?.videoId);
  const [localInput, setLocalInput] = useState('');
  const [input, setInput] = useState('');
  const [, startInputTransition] = useTransition();

  const handleInputChange = (val: string) => {
    setLocalInput(val);
    startInputTransition(() => {
      setInput(val);
    });
  };

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = useMemo(() => (activeId ? messagesByConv[activeId] || [] : []), [activeId, messagesByConv]);
  const activeConv = useMemo(() => conversations.find((c) => c.id === activeId) || null, [conversations, activeId]);

  useEffect(() => { bindNetwork(); }, [bindNetwork]);

  useEffect(() => {
    try {
      const savedOpen = localStorage.getItem(OPEN_KEY);
      if (savedOpen === '1') setOpen(true);
    } catch (e) {
      console.debug('[ChatDock] LocalStorage open_key read failed:', e);
    }
  }, [setOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, open ? '1' : '0');
    } catch (e) {
      console.debug('[ChatDock] LocalStorage open_key write failed:', e);
    }
    if (!open) {
      setShowThreads(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      await loadConversations();
      if (cancelled) return;
      requestAnimationFrame(() => inputRef.current?.focus());

      const state = useChatStore.getState();
      
      // If we have an analysis or videoId context, try to ground in that thread
      if (analysisId || videoId) {
        const existing = state.conversations.find((c) => 
          (analysisId && c.analysisId === analysisId) || 
          (videoId && c.videoId === videoId)
        );
        if (existing) {
          // If the conversation matched by videoId but has a different analysisId (due to re-analysis),
          // update it in-place and save to database.
          if (analysisId && existing.analysisId !== analysisId) {
            void useChatStore.getState().updateConversationAnalysisId(existing.id, analysisId);
          }
          await selectConversation(existing.id);
        } else if (analysisId) {
          await newConversation({ analysisId });
        }
      } else {
        // No analysis context — clear activeId so chat starts empty until user picks a thread
        const state2 = useChatStore.getState();
        if (state2.activeId) {
          useChatStore.setState({ activeId: null });
        }
      }
      
      if (cancelled) return;
      // On open / conversation load, always land on the latest message
      // (the list otherwise stays pinned at the top).
      requestAnimationFrame(() => {
        if (cancelled) return;
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [open, analysisId, videoId, loadConversations, selectConversation, newConversation]);

  useEffect(() => {
    if (open && activeId) void selectConversation(activeId);
  }, [open, activeId, selectConversation]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    // While streaming, only follow if the user is already at the bottom (don't
    // yank them up mid-read). On open or a message-set change (conversation
    // switch / initial load), always land on the latest message.
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (!sending || nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, sending, open]);

  // Generate and inject dynamic follow-up prompts after assistant responses complete
  useEffect(() => {
    // Validate minimum requirements for prompt injection
    if (!activeId || messages.length < 2 || sending) return;

    const latestMessage = messages[messages.length - 1];
    const userMessage = messages[messages.length - 2];

    // Check eligibility: latest is assistant, has content, no OPTIONS, not short
    if (
      !latestMessage ||
      !userMessage ||
      latestMessage.role !== 'assistant' ||
      userMessage.role !== 'user' ||
      latestMessage.content.includes('OPTIONS:') ||
      latestMessage.content.length < 100
    ) {
      return;
    }

    try {
      const analysisTitle = useAnalysisStore.getState().analysis?.title;
      const videoTitle = useAnalysisStore.getState().videoMetadata?.title;
      const conversationHistory = messages.slice(-6).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      const prompts = generateFollowupPrompts({
        userQuestion: userMessage.content,
        assistantResponse: latestMessage.content,
        videoTitle: videoTitle || analysisTitle,
        conversationHistory,
      });

      const optionsJson = JSON.stringify(prompts);
      const updatedContent = `${latestMessage.content}\n\nOPTIONS: ${optionsJson}`;

      useChatStore.setState((state) => {
        // Guard: re-verify sending state hasn't changed mid-injection (streaming may have restarted)
        if (state.sending) {
          console.debug('[ChatDock] Sending state changed mid-injection, aborting to prevent duplicates');
          return state;
        }
        // Guard: re-verify message still exists and hasn't been mutated (OPTIONS already added)
        const messages = state.messagesByConv[activeId as string] || [];
        const msg = messages.find((m) => m.id === latestMessage.id);
        if (!msg || msg.content.includes('OPTIONS:')) {
          return state;
        }

        return {
          messagesByConv: {
            ...state.messagesByConv,
            [activeId as string]: messages.map((m) =>
              m.id === latestMessage.id ? { ...m, content: updatedContent } : m
            ),
          },
        };
      });
    } catch (error) {
      console.debug('[ChatDock] Follow-up prompt generation failed:', error);
    }
  }, [messages, activeId, sending]);

  const scrollToBottom = () => {
    const el = listRef.current;
    if (el) requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
  };

  const submit = async (text: string) => {
    const t = text.trim();
    if (!t || sending) return;
    setInput('');
    setLocalInput('');
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
    else if (e.key === 'Escape') { startTransition(() => { setOpen(false); }); }
  };

  // --- Collapsed: slim bar -------------------------------------------------
  if (!open) {
    return (
      <div className="flex-shrink-0 w-full border-t border-[var(--line)] bg-[rgb(11_14_20_/_0.97)] backdrop-blur-[12px] h-[46px] flex items-center px-4 gap-[10px]">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open chat"
          className="flex-1 flex items-center gap-[10px] bg-transparent border-none text-[var(--ink-secondary)] cursor-pointer font-mono text-[12.5px] h-full"
        >
          <Icon icon="solar:chat-round-dots-bold" size={17} className="text-[var(--accent-ink)]" />
          <span className="font-semibold text-[var(--ink)]">Synthesis Chat</span>
          <span className="text-[var(--ink-muted)] overflow-hidden text-ellipsis whitespace-nowrap">
            {activeConv ? `· ${activeConv.title}` : analysisTitle ? `· ask about “${analysisTitle.slice(0, 40)}”` : '· ask anything'}
          </span>
          <PersistStatusIndicator state={persistState} />
        </button>
        <button onClick={() => setOpen(true)} aria-label="Expand chat" title="Expand" className="grid place-items-center w-7 h-7 rounded-lg border border-[var(--line)] bg-transparent text-[var(--ink-muted)] cursor-pointer">
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
      className="flex-shrink-0 w-full border-t border-[var(--line)] bg-[rgb(11_14_20_/_0.97)] backdrop-blur-[12px] h-[min(40vh,_420px)] flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between py-[9px] px-3.5 border-b border-[var(--line)] bg-[rgb(26_31_43_/_0.6)]">
        <div className="flex items-center min-w-0">
          <button
            onClick={() => setShowThreads((v) => !v)}
            title="Switch thread"
            className="flex items-center gap-2 min-w-0 bg-transparent border-none text-[var(--ink)] cursor-pointer font-mono text-[12.5px] font-semibold"
          >
            <Icon icon="solar:chat-round-dots-linear" size={16} className="text-[var(--accent-ink)] flex-shrink-0" />
            <span className="overflow-hidden text-ellipsis whitespace-nowrap max-w-[220px]">{activeConv?.title || 'New chat'}</span>
            <Icon icon="solar:alt-arrow-down-linear" size={13} className="text-[var(--ink-muted)] flex-shrink-0" />
          </button>
          <PersistStatusIndicator state={persistState} />
        </div>
        <div className="flex gap-1.5">
          <button onClick={handleNew} title="New chat" className="grid place-items-center w-7 h-7 rounded-lg border border-[var(--line)] bg-transparent text-[var(--ink-muted)] cursor-pointer"><Icon icon="solar:pen-new-square-linear" size={14} /></button>
          <button onClick={() => setOpen(false)} aria-label="Collapse chat" title="Collapse" className="grid place-items-center w-7 h-7 rounded-lg border border-[var(--line)] bg-transparent text-[var(--ink-muted)] cursor-pointer"><Icon icon="solar:alt-arrow-down-linear" size={16} /></button>
        </div>
      </div>

      {/* Thread switcher */}
      {showThreads && (
        <div className="max-h-[200px] overflow-y-auto border-b border-[var(--line)] bg-[rgb(8_11_17_/_0.8)]">
          {conversations.length === 0 && <div className="p-3 text-[var(--ink-muted)] font-mono text-[11px]">No conversations yet</div>}
          {conversations.map((c) => (
            <div key={c.id} className="flex items-center gap-1.5 py-0.5 px-2">
              <button
                onClick={() => { void selectConversation(c.id); setShowThreads(false); }}
                className={`flex-1 min-w-0 text-left p-2 rounded-lg border-none cursor-pointer font-mono text-[11.5px] overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-[7px] ${c.id === activeId ? 'bg-[var(--accent-a12)] text-[var(--accent-ink)]' : 'bg-transparent text-[var(--ink-secondary)]'}`}
              >
                {c.analysisId && <Icon icon="solar:link-round-angle-linear" size={12} className="flex-shrink-0 opacity-70" />}
                <span className="overflow-hidden text-ellipsis">{c.title}</span>
              </button>
              <button onClick={() => void deleteConversation(c.id)} title="Delete" className="grid place-items-center w-[22px] h-[22px] rounded-lg border border-[var(--line)] bg-transparent text-[var(--ink-muted)] cursor-pointer"><Icon icon="solar:trash-bin-minimalistic-linear" size={12} /></button>
            </div>
          ))}
        </div>
      )}

      {/* Messages — centered column for readable line length */}
      <div ref={listRef} aria-live="polite" className="flex-1 overflow-y-auto py-3 px-0">
        <div className="max-w-[820px] mx-auto px-3 lg:px-4 flex flex-col gap-3">
          {messages.length === 0 && !sending && (
            <div className="my-6 mx-auto text-center text-[var(--ink-muted)] font-mono text-xs leading-[1.6]">
              <Icon icon="solar:chat-square-like-linear" size={28} className="text-[var(--ink-muted)] mb-2 mx-auto" />
              <div>{analysisTitle ? `Ask about “${analysisTitle.slice(0, 48)}”` : 'Ask anything —'}</div>
              <div>this thread is saved to your history.</div>
            </div>
          )}
          {messages.map((m) => {
            const { body, options } = m.role === 'assistant' ? parseAssistant(m.content) : { body: m.content, options: [] as string[] };
            const isUser = m.role === 'user';
            return (
              <div key={m.id} className={`flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}>
                <div 
                  className={isUser ? "max-w-[85%] py-3 px-4 rounded-lg text-[13.5px] leading-[1.6] bg-[var(--accent)] text-[var(--void)] border-none whitespace-pre-wrap break-words" : "prose prose-invert max-w-[85%] prose-p:text-xs prose-p:leading-relaxed prose-headings:text-sm prose-headings:mt-2 prose-headings:mb-1 py-3 px-4 rounded-lg text-[13.5px] leading-[1.6] bg-[rgb(26_31_43_/_0.85)] text-[var(--ink-secondary)] border border-[var(--line)] break-words"}
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
                        pre: ({ children }) => (
                          <pre className="bg-slate-900/60 p-3 rounded-lg border border-[var(--line-faint)] overflow-x-auto my-3 font-mono text-[11px] leading-relaxed text-[var(--ink-secondary)]">
                            {children}
                          </pre>
                        ),
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
                            <code className="block font-mono text-[11px] leading-relaxed text-[var(--ink-secondary)]">
                              {parseAnsiToReact(codeText)}
                            </code>
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
                  <div className="flex gap-1.5 ml-0.5">
                    <button onClick={() => navigator.clipboard?.writeText(body).catch((e) => { const msg = e instanceof Error ? e.message : String(e); console.error('[clipboard-copy]', { message: msg }); })} title="Copy" className="grid place-items-center w-6 h-6 rounded-md border border-[var(--line)] bg-transparent text-[var(--ink-muted)] cursor-pointer">
                      <Icon icon="solar:copy-linear" size={13} />
                    </button>
                  </div>
                )}
                {!isUser && options.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 max-w-[92%]">
                    {options.map((opt) => (
                      <button key={opt} onClick={() => void submit(opt)} disabled={sending}
                        className={`py-2 px-3 rounded-lg border border-[var(--accent)] bg-[var(--accent-a10)] text-[var(--accent-ink)] font-mono text-[11.5px] text-left ${sending ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {sending && (
            <div className="flex gap-[5px] py-[9px] px-[13px] self-start">
              {[0, 1, 2].map((i) => (
                <span key={i} className="w-1.5 h-1.5 rounded-full bg-[var(--ink-muted)]" style={{ animation: `hx-pulse 1.2s ease-in-out ${i * 0.18}s infinite` }} />
              ))}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-[var(--line)] px-3 lg:px-4 py-2">
        <div className="max-w-[820px] mx-auto flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={localInput}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Message… (Enter to send, Shift+Enter for newline)"
            className="flex-1 resize-none max-h-[140px] py-2 px-2.5 rounded-lg border border-[var(--line)] bg-[rgb(8_11_17_/_0.8)] text-[var(--ink)] text-[13.5px] leading-normal outline-none hx-field"
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() || sending}
            aria-label="Send message"
            className={`flex-shrink-0 w-10 h-10 rounded-lg border-none grid place-items-center ${!input.trim() || sending ? 'cursor-not-allowed bg-[rgb(51_65_85_/_0.5)]' : 'cursor-pointer bg-[var(--accent)]'} text-[var(--void)]`}
          >
            <Icon icon="solar:arrow-up-linear" size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Split an assistant reply into its body and the trailing OPTIONS chips. */
function parseAssistant(content: string): { body: string; options: string[] } {
  const m = content.match(/OPTIONS:\s*(\[[\s\S]*\])\s*$/);
  if (!m || m.index === undefined) return { body: content.trim(), options: [] };
  let options: string[] = [];
  try {
    const arr = JSON.parse(m[1] ?? '[]');
    if (Array.isArray(arr)) options = arr.filter((x) => typeof x === 'string').slice(0, 4);
  } catch (e) {
    console.debug('[ChatDock] Assistant reply options JSON parse failed (streaming/malformed):', e);
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

function PersistStatusIndicator({ state }: { state: 'idle' | 'saving' | 'saved' | 'failed' | 'aborted' }) {
  if (state === 'idle') return null;

  let color = 'var(--ink-muted)';
  let label = '';
  let pulse = false;

  switch (state) {
    case 'saving':
      color = 'var(--warn)';
      label = 'saving';
      pulse = true;
      break;
    case 'saved':
      color = 'var(--ok)';
      label = 'saved';
      break;
    case 'failed':
      color = 'var(--err)';
      label = 'save failed';
      break;
    case 'aborted':
      color = 'var(--ink-muted)';
      label = 'aborted';
      break;
  }

  return (
    <div className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--ink-muted)] ml-2">
      <span
        className="w-1.5 h-1.5 rounded-full inline-block"
        style={{
          backgroundColor: color,
          animation: pulse ? 'hx-pulse 1.2s ease-in-out infinite' : 'none',
        }}
      />
      <span>{label}</span>
    </div>
  );
}

