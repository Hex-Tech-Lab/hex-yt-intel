'use client';

import { memo, useEffect, useMemo, useRef, useState, startTransition } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  type MarkdownInlinePlugin,
} from '@astryxdesign/core';
import { useChatStore } from '@/store/useChatStore';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { preprocessMarkdown, parseAnsiToReact } from '@/lib/utils/format';
import { EXPAND_MARKER_PATTERN } from '@/lib/utils/citation-truncate';
import { generateFollowupPrompts } from '@/lib/utils/generate-followup-prompts';
import { findMatchingConversation, filterConversationsForContext } from '@/lib/utils/find-chat-conversation';
import { TimestampLink } from '@/components/TimestampLink';
import { showToast, copyChatAsMarkdown, exportChatAsMarkdown, type ChatMessageForExport } from '@/lib/dashboard/export';

export interface ChatDockProps {
  /** Active analysis for grounding new threads (optional). */
  analysisId?: string | null;
  analysisTitle?: string;
}

const OPEN_KEY = 'hx-chatdock-open';

/**
 * Truncated citation-Point cells (see truncateCitationPoints, format.tsx)
 * embed an `⟦EXPAND:<percent-encoded rest>⟧` marker in place of the cut
 * text. Astryx's `inlinePlugins` matches that marker against parsed text
 * nodes (verified live to fire inside table cells, not just prose) and
 * swaps it for this toggle -- the full text isn't hidden with CSS, it's
 * simply absent from the DOM until the user asks for it, same as a
 * Facebook/X "See more". No Astryx internals touched: inlinePlugins is an
 * extension point Astryx already ships.
 *
 * The `encodedRest` payload is only ever PRODUCED by truncateCitationPoints,
 * but this plugin matches the marker pattern against arbitrary rendered
 * text, including a hand-authored or corrupted `⟦EXPAND:...⟧` string in an
 * assistant response -- decodeURIComponent throws URIError on malformed
 * percent-encoding, so it's wrapped rather than trusted (cubic review, PR
 * #177).
 *
 * The expanded tail is rendered through a nested <Markdown>, not as raw
 * text: truncateCitationPoints runs after linkifyTimestamps, so the cut
 * text can itself contain markdown link syntax (e.g. another in-sentence
 * timestamp reference) -- rendering it as a literal string would show that
 * syntax raw instead of as a clickable link (cubic review, PR #177).
 * `chatInlinePlugins` is referenced here even though it's declared below --
 * safe because this function only runs at React render time, well after
 * the module has finished evaluating top to bottom.
 */
function ExpandableCitationPoint({ encodedRest }: { encodedRest: string }) {
  const [expanded, setExpanded] = useState(false);
  let rest = '';
  if (expanded) {
    try {
      rest = decodeURIComponent(encodedRest);
    } catch (e) {
      console.debug('[ChatDock] Malformed EXPAND marker, showing empty expansion:', e);
    }
  }
  return (
    <>
      {expanded && rest ? <Markdown inlinePlugins={chatInlinePlugins} display="inline">{rest}</Markdown> : null}
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={expanded ? 'Hide full citation point' : 'Show full citation point'}
        onClick={() => setExpanded((e) => !e)}
        className="text-[var(--accent)] hover:underline ml-1 font-medium"
      >
        {expanded ? 'less' : '…more'}
      </button>
    </>
  );
}

const chatInlinePlugins: MarkdownInlinePlugin[] = [
  {
    pattern: EXPAND_MARKER_PATTERN,
    render: (match, key) => <ExpandableCitationPoint key={key} encodedRest={match[1] ?? ''} />,
  },
];

/**
 * Hoisted to module scope (mirrors SelectedDimensionReadout's
 * `readoutComponents`) so it isn't recreated per message per render.
 * Astryx `Markdown` has no table/list component-override slots (unlike
 * react-markdown) -- lists/tables fall back to Astryx's own built-in
 * styling, same tradeoff already accepted in SelectedDimensionReadout.
 * Table column widths are instead reshaped from outside via the
 * `chat-answer-table` global CSS class (app/globals.css) using plain th/td
 * element selectors, since there's no React-level way to hint per-column
 * width for a Markdown-rendered table. Per-cell CONTENT truncation (the
 * citation Point column) goes through `chatInlinePlugins` above instead --
 * that IS a real React-level override point Astryx exposes, just scoped to
 * text-node patterns rather than table structure.
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
  const threadsForContext = useMemo(
    () => filterConversationsForContext(conversations, analysisId, videoId),
    [conversations, analysisId, videoId]
  );
  const [copiedAllHeader, setCopiedAllHeader] = useState(false);
  const handleCopyAllHeader = () => {
    copyChatAsMarkdown(exportableMessages, activeConv?.title);
    setCopiedAllHeader(true);
    setTimeout(() => setCopiedAllHeader(false), 2000);
  };

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
      // Bumped as early as possible in this restore attempt so a
      // still-in-flight OLDER attempt's later updateConversationAnalysisId
      // call sees a stale epoch and no-ops its PATCH (see restoreEpoch doc,
      // useChatStore.ts).
      const epoch = useChatStore.getState().beginRestoreEpoch();
      await loadConversations();
      if (cancelled) return;
      requestAnimationFrame(() => inputHandleRef.current?.focus());

      const state = useChatStore.getState();
      
      // If we have an analysis or videoId context, try to ground in that thread.
      // Matching a video visit to its existing conversation ONLY -- never
      // auto-creates one. Live-reported bug (2026-08-01): visiting a video
      // was silently creating a new chat_conversations row with no user
      // action, producing spurious "sessions" in history that were really
      // just re-visits of the same video. Creation now only happens from
      // the explicit "new chat" button (see newConversation() call below).
      if (analysisId || videoId) {
        const existing = findMatchingConversation(state.conversations, analysisId, videoId);
        if (existing) {
          // If the conversation matched by videoId but has a different analysisId (due to re-analysis),
          // update it in-place and save to database. Cancelled check before
          // the PATCH, not after -- it's a persisted DB write, so firing it
          // unconditionally after this effect has already been superseded
          // by a newer video/analysisId change could rebind a shared
          // conversation to the wrong (stale) analysis.
          if (!cancelled && analysisId && existing.analysisId !== analysisId) {
            void useChatStore.getState().updateConversationAnalysisId(existing.id, analysisId, { epoch });
          }
          if (cancelled) return;
          await selectConversation(existing.id);
        } else {
          // No existing conversation for this video -- leave empty rather
          // than auto-creating one. The user's explicit "new chat" button
          // is the only place newConversation() should be called from.
          useChatStore.setState({ activeId: null });
        }
      } else {
        // No analysis/video context (general chat) -- restore the
        // browser's last-active conversation instead of forcing empty.
        // loadConversations() deliberately never writes activeId itself
        // (see useChatStore.ts) specifically so a context-scoped restore
        // like the branch above can never be raced/overwritten by it; this
        // is the one place that opts INTO the localStorage-based restore.
        useChatStore.setState({ activeId: null });
        await useChatStore.getState().restoreLastActiveConversation();
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

  const lastFetchedActiveIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeId && lastFetchedActiveIdRef.current !== activeId) {
      lastFetchedActiveIdRef.current = activeId;
      void selectConversation(activeId);
    }
  }, [activeId, selectConversation]);

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
    await sendMessage(t, { analysisId: analysisId ?? null, videoId: videoId ?? null });
  };

  const handleNew = async () => {
    setShowThreads(false);
    // Ground the explicitly-created new chat in whatever video/analysis is
    // currently open -- previously passed analysisId: null unconditionally,
    // so clicking "New Chat" while viewing a video created a conversation
    // NOT associated with it. That orphaned conversation would then never
    // resurface when revisiting the video (the match logic correctly
    // wouldn't find it), while a real one appeared to be "missing" --
    // live-reported 2026-08-01.
    await newConversation({ analysisId: analysisId ?? null, videoId: videoId ?? null });
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

  // --- Collapsed / Expanded, animated with framer-motion -------------------
  // Both states live under one AnimatePresence so the toggle is a real
  // exit/enter transition (the previous <ViewTransition> here produced no
  // visible effect in production, replaced with the same AnimatePresence
  // system already proven in AnalysisHero/RightPanelAccordion).
  return (
    <AnimatePresence mode="wait" initial={false}>
      {!open ? (
        <motion.div
          key="chat-collapsed"
          data-chat-dock="true"
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 16, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="flex-shrink-0 w-full border-t border-[var(--line)] bg-[rgb(11_14_20_/_0.97)] backdrop-blur-[12px] h-[46px] flex items-center px-4 gap-[10px]"
        >
          <button
            onClick={() => startTransition(() => setOpen(true))}
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
          <IconButton label="Expand chat" variant="ghost" size="sm" icon={<Icon icon="solar:alt-arrow-up-linear" size={16} />} onClick={() => startTransition(() => setOpen(true))} />
        </motion.div>
      ) : (
      <motion.div
        key="chat-expanded"
        data-chat-dock="true"
        role="dialog"
        aria-label="Synthesis chat"
        initial={{ y: 28, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 28, opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className={`w-full border-t border-[var(--line)] bg-[rgb(11_14_20_/_0.97)] backdrop-blur-[12px] flex flex-col origin-bottom ${
          // 'full' overlays the entire main column (absolute within the
          // relative <main>) instead of using a fixed viewport calc: a flow
          // child taller than the space under the header gets its bottom (the
          // input row) clipped by main's overflow-hidden, and any hardcoded
          // offset leaves a sliver of content peeking at the top.
          heightState === 'full'
            ? 'absolute inset-0 z-30'
            : `flex-shrink-0 transition-[height] duration-300 ease-in-out ${heightState === 'half' ? 'h-[50vh]' : 'h-[min(40vh,_420px)]'}`
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
                icon={<Icon icon={copiedAllHeader ? 'solar:check-read-linear' : 'solar:copy-linear'} size={14} />}
                onClick={handleCopyAllHeader}
                className={copiedAllHeader ? '!border-[var(--accent)] !text-[var(--accent)] !bg-[var(--accent-a10)]' : ''}
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
              startTransition(() => {
                setHeightState((curr) => {
                  if (curr === 'normal') return 'half';
                  if (curr === 'half') return 'full';
                  return 'normal';
                });
              });
            }}
          />
          <IconButton label="Collapse chat" variant="ghost" size="sm" icon={<Icon icon="solar:alt-arrow-down-linear" size={16} />} onClick={() => startTransition(() => setOpen(false))} />
        </div>
      </div>

      {/* Thread switcher */}
      {showThreads && (
        <div className="max-h-[240px] overflow-y-auto border-b border-[var(--line)] bg-[rgb(8_11_17_/_0.95)] backdrop-blur-md p-1.5 flex flex-col gap-1">
          <button
            onClick={() => { void newConversation({ analysisId: analysisId ?? null, videoId: videoId ?? null }); setShowThreads(false); }}
            className="w-full text-left p-2 rounded-lg border border-dashed border-[var(--accent)]/50 bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 text-[var(--accent)] cursor-pointer font-mono text-[11.5px] font-semibold flex items-center justify-between transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <Icon icon="solar:add-circle-linear" size={14} />
              + Start New Chat Thread
            </span>
          </button>
          {threadsForContext.length === 0 ? (
            <div className="p-3 text-[var(--ink-muted)] font-mono text-[11px]">No conversations yet</div>
          ) : (
            threadsForContext.map((c) => {
              const formattedDate = c.updatedAt || c.createdAt ? new Date(c.updatedAt || c.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
              const rawTitle = c.title || 'Untitled Chat';
              // Explicit character truncation (not CSS text-ellipsis) so the
              // title consistently reads "Name...· date" regardless of flex
              // sibling widths -- CSS ellipsis truncates unpredictably when
              // a fixed-width sibling (the date) competes for the same row.
              const CHAT_TITLE_MAX_CHARS = 26;
              const displayTitle = rawTitle.length > CHAT_TITLE_MAX_CHARS ? `${rawTitle.slice(0, CHAT_TITLE_MAX_CHARS)}...` : rawTitle;
              return (
                <div key={c.id} className="flex items-center gap-1.5 px-1">
                  <button
                    onClick={() => { void selectConversation(c.id); setShowThreads(false); }}
                    title={rawTitle}
                    className={`flex-1 min-w-0 text-left p-2 rounded-lg border-none cursor-pointer font-mono text-[11.5px] overflow-hidden flex items-center justify-between gap-2 transition-colors ${
                      c.id === activeId ? 'bg-[var(--accent-a12)] text-[var(--accent-ink)] font-bold' : 'bg-transparent text-[var(--ink-secondary)] hover:bg-[var(--surface)]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {c.analysisId && <Icon icon="solar:link-round-angle-linear" size={12} className="flex-shrink-0 opacity-70" />}
                      <span className="whitespace-nowrap">{displayTitle}</span>
                    </div>
                    {formattedDate && (
                      <span className="text-[10px] text-[var(--ink-muted)] font-normal flex-shrink-0">{formattedDate}</span>
                    )}
                  </button>
                  <IconButton label="Delete conversation" variant="ghost" size="sm" icon={<Icon icon="solar:trash-bin-minimalistic-linear" size={12} />} onClick={() => void deleteConversation(c.id)} />
                </div>
              );
            })
          )}
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
          if (!isUser && !body.trim()) return null;
          const sender = isUser ? 'user' : 'assistant';
          return (
            <ChatMessage key={m.id} sender={sender}>
              <ChatMessageBubble
                variant="filled"
                className={isUser
                  ? '!rounded-lg max-w-[85%] text-[13.5px] leading-[1.6] bg-[var(--accent)] text-[var(--void)] whitespace-pre-wrap break-words !p-3.5 !py-2.5 !px-3.5'
                  : 'chat-answer-table prose prose-invert !rounded-lg max-w-[92%] prose-p:text-xs prose-p:leading-relaxed prose-p:my-1 prose-headings:text-sm prose-headings:mt-2 prose-headings:mb-1 text-[13.5px] leading-[1.6] bg-[rgb(26_31_43_/_0.85)] text-[var(--ink-secondary)] border border-[var(--line)] break-words !p-3.5 !py-2.5 !px-3.5'
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
                  <Markdown components={chatMarkdownComponents} inlinePlugins={chatInlinePlugins} density="compact">
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
          className="!rounded-lg"
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
      </motion.div>
      )}
    </AnimatePresence>
  );
}

export const ChatDock = memo(ChatDockImpl);

/** Split an assistant reply into its body and the trailing OPTIONS chips. */
function parseAssistant(content: string): { body: string; options: string[] } {
  const matchResult = content.match(/OPTIONS:\s*(\[[\s\S]*\])\s*$/);
  if (!matchResult || matchResult.index === undefined) return { body: content.trim(), options: [] };
  const validOptions: string[] = [];
  try {
    const parsedJson = JSON.parse(matchResult[1] ?? '[]');
    if (Array.isArray(parsedJson)) {
      for (const optItem of parsedJson) {
        if (typeof optItem === 'string') {
          validOptions.push(optItem);
          if (validOptions.length === 4) break;
        }
      }
    }
  } catch (e) {
    console.debug('[ChatDock] Assistant reply options JSON parse failed (streaming/malformed):', e);
  }
  const bodyText = content.slice(0, matchResult.index).trim();
  return { body: bodyText || content.trim(), options: validOptions };
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

