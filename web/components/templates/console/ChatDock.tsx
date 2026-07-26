'use client';

import { memo, useEffect, useMemo, useRef, useState, startTransition } from 'react';
import * as Sentry from '@sentry/nextjs';
import { Icon } from '@/components/templates/_shared/primitives';
import {
  IconButton,
  ChatMessageList,
  ChatMessage,
  ChatMessageBubble,
  ChatSystemMessage,
  ChatComposer,
  ChatComposerInput,
  Markdown,
  useImperativeAlertDialog,
  type ChatComposerInputHandle,
  type MarkdownComponents,
} from '@astryxdesign/core';
import { useChatStore } from '@/store/useChatStore';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { preprocessMarkdown, parseAnsiToReact } from '@/lib/utils/format';
import { generateFollowupPrompts } from '@/lib/utils/generate-followup-prompts';
import { TimestampLink } from '@/components/TimestampLink';
import { showToast, copyChatAsMarkdown, exportChatAsMarkdown, type ChatMessageForExport } from '@/lib/dashboard/export';

export interface ChatDockProps {
  /** Active analysis for grounding new threads (optional). */
  analysisId?: string | null;
  analysisTitle?: string;
}

const OPEN_KEY = 'hx-chatdock-open';

/**
 * Hoisted to module scope (mirrors SelectedDimensionReadout's
 * `readoutComponents`) so it isn't recreated per message per render.
 * Astryx `Markdown` has no table/list override slots (unlike react-markdown) --
 * lists/tables fall back to Astryx's own built-in styling, same tradeoff
 * already accepted in SelectedDimensionReadout.
 */
const chatMarkdownComponents: MarkdownComponents = {
  paragraph: ({ children }) => (
    <p className="text-[12px] leading-relaxed mb-3.5 mt-1.5 text-[var(--ink-secondary)] last:mb-0">{children}</p>
  ),
  link: ({ href, children }) => {
    if (href?.startsWith('#t=')) {
      const timestamp = href.replace('#t=', '');
      return <TimestampLink timestamp={timestamp}>{children}</TimestampLink>;
    }
    return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
  },
  inlineCode: ({ children }) => (
    <code className="bg-slate-800/80 px-1.5 py-0.5 rounded font-mono text-[11px] text-[var(--ink-secondary)]">
      {parseAnsiToReact(children)}
    </code>
  ),
  code: ({ code }) => (
    <pre className="bg-slate-900/60 p-3 rounded-lg border border-[var(--line-faint)] overflow-x-auto my-3 font-mono text-[11px] leading-relaxed text-[var(--ink-secondary)]">
      <code className="block">{parseAnsiToReact(code.replace(/\n$/, ''))}</code>
    </pre>
  ),
};

/**
 * Bottom-docked, vertically-collapsible chat sheet. Rendered into DashboardLayout's
 * `dock` slot, so it spans the MAIN COLUMN (between the left sidebar and the right
 * rail) and never covers the panels. Collapsed = a slim bar; expanded = a sheet that
 * grows UPWARD. Durable threads via useChatStore → /api/chat → Postgres; survives all
 * navigation because the layout (and this dock) stay mounted.
 */
function ChatDockImpl({ analysisId, analysisTitle }: ChatDockProps) {
  const {
    conversations, activeId, messagesByConv, sending, persistState,
    loadConversations, selectConversation, newConversation, sendMessage, deleteConversation, bindNetwork,
    isChatOpen: open, setChatOpen: setOpen,
  } = useChatStore();
  const [showThreads, setShowThreads] = useState(false);
  const [heightState, setHeightState] = useState<'normal' | 'half' | 'full'>('normal');
  const videoId = useAnalysisStore((s) => s.videoMetadata?.videoId);
  const [localInput, setLocalInput] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  const handleCopyMessage = (id: string, body: string) => {
    navigator.clipboard?.writeText(body)
      .then(() => {
        setCopiedMessageId(id);
        showToast('Message copied to clipboard!');
        setTimeout(() => setCopiedMessageId((current) => (current === id ? null : current)), 2000);
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[clipboard-copy]', { message: msg });
        showToast('Failed to copy message.', 'error');
      });
  };

  const listRef = useRef<HTMLDivElement>(null);
  const inputHandleRef = useRef<ChatComposerInputHandle>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const processedMessageIdsRef = useRef<Set<string>>(new Set());

  const messages = useMemo(() => (activeId ? messagesByConv[activeId] || [] : []), [activeId, messagesByConv]);
  // Assistant turns carry a trailing OPTIONS:[...] chip payload (see parseAssistant
  // below) that must not leak into a copy-all/export -- reuses the same parser the
  // per-message body/chip rendering already uses, so the two paths can't drift.
  const exportableMessages = useMemo<ChatMessageForExport[]>(
    () => messages.map((m) => ({ role: m.role, body: m.role === 'assistant' ? parseAssistant(m.content).body : m.content })),
    [messages]
  );
  const activeConv = useMemo(() => conversations.find((c) => c.id === activeId) || null, [conversations, activeId]);

  // Reset processed message tracking when conversation changes
  useEffect(() => {
    processedMessageIdsRef.current.clear();
  }, [activeId]);

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
      requestAnimationFrame(() => inputHandleRef.current?.focus());

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
          // Clear any previous conversation first to prevent stale chat from loading
          useChatStore.setState({ activeId: null });
          await newConversation({ analysisId });
        } else {
          // VideoId exists but no analysisId (yet) - reset activeId
          useChatStore.setState({ activeId: null });
        }
      } else {
        // No analysis context — clear activeId so chat starts empty until user picks a thread
        useChatStore.setState({ activeId: null });
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
    if (!activeId || messages.length < 2 || sending) return;

    const latestMessage = messages[messages.length - 1];
    const userMessage = messages[messages.length - 2];

    if (!latestMessage || !userMessage) return;
    if (latestMessage.role !== 'assistant' || userMessage.role !== 'user') return;

    // Idempotency: skip if already processed or OPTIONS already present
    if (processedMessageIdsRef.current.has(latestMessage.id)) return;
    if (latestMessage.content.includes('OPTIONS:') || latestMessage.content.length < 100) return;

    // Mark as processed immediately to prevent duplicate injection during rerenders
    processedMessageIdsRef.current.add(latestMessage.id);

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

      // Data-driven, not a keyword guess: server (ProcessChatMessageUseCase,
      // which has DB access to the real comment count) already told us
      // whether the persisted sample is smaller than the actual total.
      const hasMoreComments = useChatStore.getState().hasMoreCommentsByConv[activeId];
      if (hasMoreComments) {
        prompts.unshift('[ACTION:expand-comments]');
      }

      const optionsJson = JSON.stringify(prompts);
      const updatedContent = `${latestMessage.content}\n\nOPTIONS: ${optionsJson}`;

      // Re-verify state at mutation time to prevent race conditions
      useChatStore.setState((state) => {
        if (state.sending) return state;

        const convMessages = state.messagesByConv[activeId as string] || [];
        const msg = convMessages.find((m) => m.id === latestMessage.id);
        // Final guard: ensure message hasn't been modified since effect started
        if (!msg?.content || msg.content.includes('OPTIONS:')) return state;

        return {
          messagesByConv: {
            ...state.messagesByConv,
            [activeId as string]: convMessages.map((m) =>
              m.id === latestMessage.id ? { ...m, content: updatedContent } : m
            ),
          },
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ChatDock] Follow-up prompt generation failed:', { message, error });
      Sentry.captureException(error, {
        tags: { component: 'ChatDock', operation: 'followup-prompts' },
        level: 'warning',
      });
    }
  }, [messages, activeId, sending]);

  const scrollToBottom = () => {
    const el = listRef.current;
    if (el) requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
  };

  const prevSendingRef = useRef(sending);
  useEffect(() => {
    if (prevSendingRef.current && !sending) {
      const activeEl = document.activeElement;
      const isInputOrTextArea = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || (activeEl as HTMLElement).isContentEditable);
      if (!isInputOrTextArea) {
        requestAnimationFrame(() => {
          inputHandleRef.current?.focus();
        });
      }
    }
    prevSendingRef.current = sending;
  }, [sending]);

  const expandConfirm = useImperativeAlertDialog();

  const handleExpandCommentsClick = async () => {
    if (!videoId) {
      showToast('No active video associated with this conversation for comment expansion.', 'error');
      return;
    }
    const defaultCommentCount = 500;
    try {
      const estRes = await fetch('/api/comments/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ totalCommentCount: defaultCommentCount }),
      });
      const estimate = await estRes.json().catch(() => ({ estimatedCredits: 15 }));
      const credits = estimate.estimatedCredits ?? 15;

      expandConfirm.show({
        title: 'Confirm Comment Expansion',
        description: `Uncapped Tier 3 comment fetch will analyze all comments for this video. Estimated cost: ${credits} credits. Proceed?`,
        actionLabel: 'Confirm & Expand',
        onAction: async () => {
          expandConfirm.hide();
          try {
            const startRes = await fetch('/api/comments/tier3/start', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ videoId, totalCommentCount: defaultCommentCount }),
            });
            if (!startRes.ok) {
              const errData = await startRes.json().catch(() => ({ error: 'Failed' }));
              throw new Error(errData.error || 'Failed to start expansion');
            }
            showToast('Comment expansion started! Full sentiment processing in background.');
            await submit('Started full comment expansion.');
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            showToast(`Expansion failed: ${msg}`, 'error');
          }
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Could not estimate cost: ${msg}`, 'error');
    }
  };

  const submit = async (text: string) => {
    const t = text.trim();
    if (!t || sending) return;
    setLocalInput('');
    scrollToBottom(); // user just sent — always follow to the bottom
    await sendMessage(t, { analysisId: analysisId ?? null });
  };

  const handleNew = async () => {
    setShowThreads(false);
    await newConversation({ analysisId: null });
    requestAnimationFrame(() => inputHandleRef.current?.focus());
  };

  // ChatComposerInput owns Enter-to-send / Shift+Enter-for-newline / history
  // recall internally (see its handleKeyDown) — the composer's onSubmit prop
  // covers Enter. Escape-to-close-dock isn't part of its API, so it's still
  // caught here via bubbling (ChatComposerInput has no stopPropagation on
  // keydown, confirmed by reading its source).
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') startTransition(() => { setOpen(false); });
  };

  // --- Collapsed: slim bar -------------------------------------------------
  if (!open) {
    return (
      <div data-chat-dock="true" className="flex-shrink-0 w-full border-t border-[var(--line)] bg-[rgb(11_14_20_/_0.97)] backdrop-blur-[12px] h-[46px] flex items-center px-4 gap-[10px]">
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
        <IconButton label="Expand chat" variant="ghost" size="sm" icon={<Icon icon="solar:alt-arrow-up-linear" size={16} />} onClick={() => setOpen(true)} />
      </div>
    );
  }

  // --- Expanded: bottom sheet growing upward -------------------------------
  return (
    <div
      data-chat-dock="true"
      role="dialog"
      aria-label="Synthesis chat"
      className={`w-full border-t border-[var(--line)] bg-[rgb(11_14_20_/_0.97)] backdrop-blur-[12px] flex flex-col transition-all duration-300 ease-in-out ${
        // 'full' overlays the entire main column (absolute within the
        // relative <main>) instead of using a fixed viewport calc: a flow
        // child taller than the space under the header gets its bottom (the
        // input row) clipped by main's overflow-hidden, and any hardcoded
        // offset leaves a sliver of content peeking at the top.
        heightState === 'full'
          ? 'absolute inset-0 z-30'
          : `flex-shrink-0 ${heightState === 'half' ? 'h-[50vh]' : 'h-[min(40vh,_420px)]'}`
      }`}
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
          {messages.length > 0 && (
            <>
              <IconButton
                label="Copy all as markdown"
                variant="ghost"
                size="sm"
                icon={<Icon icon="solar:copy-linear" size={14} />}
                onClick={() => copyChatAsMarkdown(exportableMessages, activeConv?.title)}
              />
              <IconButton
                label="Export as markdown"
                variant="ghost"
                size="sm"
                icon={<Icon icon="solar:file-download-linear" size={14} />}
                onClick={() => exportChatAsMarkdown(exportableMessages, activeConv?.title)}
              />
            </>
          )}
          <IconButton label="New chat" variant="ghost" size="sm" icon={<Icon icon="solar:pen-new-square-linear" size={14} />} onClick={handleNew} />
          <IconButton
            label={heightState === 'normal' ? "Expand to 50%" : heightState === 'half' ? "Expand to 100%" : "Restore size"}
            variant="ghost"
            size="sm"
            icon={
              <Icon
                icon={
                  heightState === 'normal'
                    ? 'solar:maximize-square-linear'
                    : heightState === 'half'
                    ? 'solar:maximize-square-bold'
                    : 'solar:minimize-square-linear'
                }
                size={15}
              />
            }
            onClick={() => {
              setHeightState((curr) => {
                if (curr === 'normal') return 'half';
                if (curr === 'half') return 'full';
                return 'normal';
              });
            }}
          />
          <IconButton label="Collapse chat" variant="ghost" size="sm" icon={<Icon icon="solar:alt-arrow-down-linear" size={16} />} onClick={() => setOpen(false)} />
        </div>
      </div>

      {/* Thread switcher */}
      {showThreads && (
        <div className="max-h-[200px] overflow-y-auto border-b border-[var(--line)] bg-[rgb(8_11_17_/_0.8)]">
          {(() => {
            const filteredConversations = conversations.filter((c) => !videoId || c.videoId === videoId || c.id === activeId);
            return (
              <>
                {filteredConversations.length === 0 && <div className="p-3 text-[var(--ink-muted)] font-mono text-[11px]">No conversations yet</div>}
                {filteredConversations.map((c) => (
            <div key={c.id} className="flex items-center gap-1.5 py-0.5 px-2">
              <button
                onClick={() => { void selectConversation(c.id); setShowThreads(false); }}
                className={`flex-1 min-w-0 text-left p-2 rounded-lg border-none cursor-pointer font-mono text-[11.5px] overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-[7px] ${c.id === activeId ? 'bg-[var(--accent-a12)] text-[var(--accent-ink)]' : 'bg-transparent text-[var(--ink-secondary)]'}`}
              >
                {c.analysisId && <Icon icon="solar:link-round-angle-linear" size={12} className="flex-shrink-0 opacity-70" />}
                <span className="overflow-hidden text-ellipsis">{c.title}</span>
              </button>
              <IconButton label="Delete conversation" variant="ghost" size="sm" icon={<Icon icon="solar:trash-bin-minimalistic-linear" size={12} />} onClick={() => void deleteConversation(c.id)} />
            </div>
                ))}
              </>
            );
          })()}
        </div>
      )}

      {/* Messages — Astryx ChatMessageList + ChatMessage + ChatMessageBubble */}
      <ChatMessageList
        ref={listRef}
        isStreaming={sending}
        density="compact"
        gap={10}
        className="flex-1 overflow-y-auto py-3 px-3 lg:px-4"
        emptyState={
          !sending ? (
            <div className="my-6 mx-auto text-center text-[var(--ink-muted)] font-mono text-xs leading-[1.6]">
              <Icon icon="solar:chat-square-like-linear" size={28} className="text-[var(--ink-muted)] mb-2 mx-auto" />
              <div>{analysisTitle ? `Ask about "${analysisTitle.slice(0, 48)}"` : 'Ask anything —'}</div>
              <div>this thread is saved to your history.</div>
            </div>
          ) : undefined
        }
      >
        {messages.map((m) => {
          const { body, options } = m.role === 'assistant' ? parseAssistant(m.content) : { body: m.content, options: [] as string[] };
          const isUser = m.role === 'user';
          const sender = isUser ? 'user' : 'assistant';
          return (
            <ChatMessage key={m.id} sender={sender}>
              <ChatMessageBubble
                variant="filled"
                className={isUser
                  ? '!rounded-lg max-w-[85%] text-[13.5px] leading-[1.6] bg-[var(--accent)] text-[var(--void)] whitespace-pre-wrap break-words !p-3.5 !py-2.5 !px-3.5'
                  : 'prose prose-invert !rounded-lg max-w-[85%] prose-p:text-xs prose-p:leading-relaxed prose-p:my-1 prose-headings:text-sm prose-headings:mt-2 prose-headings:mb-1 text-[13.5px] leading-[1.6] bg-[rgb(26_31_43_/_0.85)] text-[var(--ink-secondary)] border border-[var(--line)] break-words !p-3.5 !py-2.5 !px-3.5'
                }
                metadata={
                  body ? (
                    <div className={`flex gap-1.5 ml-0.5 ${isUser ? 'self-end mr-0.5' : ''}`}>
                      <IconButton
                        label="Copy message"
                        variant="ghost"
                        size="sm"
                        icon={<Icon icon={copiedMessageId === m.id ? 'solar:check-read-linear' : 'solar:copy-linear'} size={13} />}
                        onClick={() => handleCopyMessage(m.id, body)}
                        className={copiedMessageId === m.id ? '!border-[var(--accent)] !text-[var(--accent)] !bg-[var(--accent-a10)]' : ''}
                      />
                    </div>
                  ) : undefined
                }
              >
                {isUser ? (
                  body
                ) : (
                  <Markdown components={chatMarkdownComponents} density="compact">
                    {preprocessMarkdown(body)}
                  </Markdown>
                )}
              </ChatMessageBubble>
              {!isUser && options.length > 0 && (
                <div className="flex flex-wrap gap-1.5 max-w-[92%] px-3 pb-1">
                  {options.map((opt) => {
                    const isExpandComments = opt.includes('expand-comments');
                    if (isExpandComments) {
                      return (
                        <button
                          key={opt}
                          onClick={() => void handleExpandCommentsClick()}
                          disabled={sending}
                          className={`py-2 px-3 rounded-lg border border-[var(--accent)] bg-[var(--accent-a15)] text-[var(--accent)] font-mono text-[11.5px] font-semibold text-left flex items-center gap-1.5 shadow-[0_0_12px_-2px_var(--accent-a20)] ${sending ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-[var(--accent-a20)]'}`}
                        >
                          <Icon icon="solar:bolt-linear" size={13} />
                          <span>Expand to full comments</span>
                        </button>
                      );
                    }
                    return (
                      <button
                        key={opt}
                        onClick={() => void submit(opt)}
                        disabled={sending}
                        className={`py-2 px-3 rounded-lg border border-[var(--accent)] bg-[var(--accent-a10)] text-[var(--accent-ink)] font-mono text-[11.5px] text-left ${sending ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              )}
            </ChatMessage>
          );
        })}
        {sending && (
          <ChatSystemMessage>
            <div className="flex gap-[5px] py-1">
              {[0, 1, 2].map((i) => (
                <span key={i} className="w-1.5 h-1.5 rounded-full bg-[var(--ink-muted)]" style={{ animation: `hx-pulse 1.2s ease-in-out ${i * 0.18}s infinite` }} />
              ))}
            </div>
          </ChatSystemMessage>
        )}
        <div ref={messagesEndRef} />
      </ChatMessageList>

      {/* Composer — ChatComposer is the layout shell (drawer/header/input/
          send-button slots); its context wires value/onChange/onSubmit/
          isDisabled/canSend to the default ChatComposerInput + ChatSendButton
          automatically (verified via ChatComposer.js: renders a
          ChatComposerContext.Provider around the body). ChatComposerInput
          itself owns Enter-to-send / Shift+Enter-for-newline / message
          history recall (see its handleKeyDown), so onKeyDown here only
          needs to catch Escape (bubbles up, no stopPropagation in the
          library's keydown handler). */}
      <div className="border-t border-[var(--line)] px-3 lg:px-4 py-2">
        <ChatComposer
          value={localInput}
          onChange={setLocalInput}
          onSubmit={(text) => void submit(text)}
          isDisabled={sending}
          density="compact"
          className="hx-field !rounded-lg"
          input={
            <ChatComposerInput
              handleRef={inputHandleRef}
              placeholder="Message… (Enter to send, Shift+Enter for newline)"
              onKeyDown={onKeyDown}
              className="!rounded-lg"
            />
          }
        />
      </div>
      {expandConfirm.element}
    </div>
  );
}

export const ChatDock = memo(ChatDockImpl);

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

