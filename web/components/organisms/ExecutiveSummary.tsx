'use client';

import { useState, useCallback } from 'react';
import * as Sentry from '@sentry/nextjs';
import { IconButton } from '@astryxdesign/core';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Icon } from '@/components/templates/_shared/primitives';

export interface ExecutiveSummaryData {
  /** Overview tier: max 3 lines */
  overview: string;
  /** Snapshot tier: max 5 lines */
  snapshot: string;
  /** Key takeaways: up to 10 bullets */
  keyTakeaways: string[];
  /** Detailed summary: up to 5 paragraphs */
  detailedSummary: string;
}

export interface ExecutiveSummaryProps {
  data: ExecutiveSummaryData | null;
  loading?: boolean;
}

type AccordionItemId = 'overview' | 'snapshot' | 'takeaways' | 'detailed';

interface ConfirmationState {
  itemId: AccordionItemId | null;
  timeoutId: NodeJS.Timeout | null;
}

/**
 * Dimension 0 — the executive summary accordion component. Four multivariant
 * summaries (Overview, Snapshot, Key Takeaways, Detailed Summary) presented as
 * a mutually exclusive accordion. First item opens by default. Smooth transitions
 * with copy-to-clipboard feature on each summary.
 */
export function ExecutiveSummary({ data, loading = false }: ExecutiveSummaryProps) {
  const [openItemId, setOpenItemId] = useState<AccordionItemId>('snapshot');
  const [copyConfirmation, setCopyConfirmation] = useState<ConfirmationState>({
    itemId: null,
    timeoutId: null,
  });

  const handleAccordionToggle = useCallback((itemId: AccordionItemId) => {
    setOpenItemId(itemId);
  }, []);

  const handleCopyToClipboard = useCallback(
    async (itemId: AccordionItemId, content: string) => {
      try {
        await navigator.clipboard.writeText(content);

        // Clear any existing timeout
        if (copyConfirmation.timeoutId) {
          clearTimeout(copyConfirmation.timeoutId);
        }

        // Show confirmation
        setCopyConfirmation({ itemId, timeoutId: null });

        // Auto-hide after 2 seconds
        const timeoutId = setTimeout(() => {
          setCopyConfirmation({ itemId: null, timeoutId: null });
        }, 2000);

        setCopyConfirmation({ itemId, timeoutId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[ExecutiveSummary] Clipboard copy failed', { message: msg });
        Sentry.captureException(err, { contexts: { executiveSummary: { itemId } } });
      }
    },
    [copyConfirmation.timeoutId]
  );

  if (!data && !loading) {
    if (typeof window !== 'undefined' && window.__CHAT_DEBUG) {
      console.debug('[ExecutiveSummary] Returning null: no data and not loading');
    }
    return null;
  }

  if (typeof window !== 'undefined' && window.__CHAT_DEBUG) {
    console.debug('[ExecutiveSummary] Rendering with data', { hasData: !!data, loading, dataKeys: data ? Object.keys(data) : null });
  }

  const isConfirmed = (itemId: AccordionItemId) => copyConfirmation.itemId === itemId;

  const items: Array<{
    id: AccordionItemId;
    label: string;
    content: string;
    type: 'text' | 'bullets' | 'paragraphs';
    maxLines?: number;
  }> = [
    { id: 'snapshot', label: 'Snapshot', content: data?.snapshot ?? '', type: 'text' },
    { id: 'overview', label: 'Overview', content: data?.overview ?? '', type: 'paragraphs' },
    { id: 'takeaways', label: 'Key Takeaways', content: data?.keyTakeaways?.join('\n') ?? '', type: 'bullets' },
    { id: 'detailed', label: 'Detailed Summary', content: data?.detailedSummary ?? '', type: 'paragraphs' },
  ];

  return (
    <section
      aria-label="Executive summary"
      className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/[0.06] p-2 sm:p-3"
    >
      <header className="mb-4 flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-[var(--accent)]/20 font-mono text-[11px] font-bold text-[var(--accent-ink)]">
          0
        </span>
        <h2 className="font-mono text-sm font-semibold tracking-tight text-[var(--ink)]">
          Executive Summary
        </h2>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">
          Synthesis · uncounted
        </span>
      </header>

      {loading && !data ? (
        <SummarySkeletons />
      ) : data ? (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <AccordionItem
              key={item.id}
              id={item.id}
              label={item.label}
              isOpen={openItemId === item.id}
              onToggle={handleAccordionToggle}
              onCopy={handleCopyToClipboard}
              isConfirmed={isConfirmed(item.id)}
              copyText={item.content}
            >
              <SummaryContent
                content={item.content}
                type={item.type}
                maxLines={item.maxLines}
              />
            </AccordionItem>
          ))}
        </div>
      ) : null}
    </section>
  );
}

interface AccordionItemProps {
  id: AccordionItemId;
  label: string;
  isOpen: boolean;
  onToggle: (id: AccordionItemId) => void;
  onCopy: (id: AccordionItemId, content: string) => Promise<void>;
  isConfirmed: boolean;
  copyText: string;
  children: React.ReactNode;
}

function AccordionItem({
  id,
  label,
  isOpen,
  onToggle,
  onCopy,
  isConfirmed,
  copyText,
  children,
}: AccordionItemProps) {
  const handleCopy = useCallback(async () => {
    await onCopy(id, copyText);
  }, [id, copyText, onCopy]);

  return (
    <div className="border border-[var(--line)] rounded-lg bg-[var(--surface)] overflow-hidden transition-all duration-200">
      <div className="flex items-center justify-between bg-[var(--bg)] border-0 border-b border-[var(--line-faint)]">
        <button
          type="button"
          onClick={() => onToggle(id)}
          aria-expanded={isOpen}
          aria-controls={`${id}-content`}
          className="flex-1 px-4 py-3 flex items-center justify-between cursor-pointer select-none hover:bg-[var(--surface)]/50 transition-colors duration-150"
        >
          <span className="text-[13px] font-semibold text-[var(--ink)] pl-1 text-left">
            {label}
          </span>

          <Icon
            icon={isOpen ? 'solar:alt-arrow-up-linear' : 'solar:alt-arrow-down-linear'}
            size={16}
            className="transition-transform duration-300 pointer-events-none flex-shrink-0"
            aria-hidden
          />
        </button>

        <IconButton
          label="Copy to clipboard"
          tooltip="Copy to clipboard"
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            void handleCopy();
          }}
          className={`mr-2 ${isConfirmed ? '!border-[var(--accent)] !text-[var(--accent)] !bg-[var(--accent-a10)]' : ''}`}
          icon={
            <Icon
              icon={isConfirmed ? 'solar:check-read-linear' : 'solar:copy-linear'}
              size={14}
            />
          }
        />
      </div>

      {/* Accordion content with smooth transition */}
      <div
        id={`${id}-content`}
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          isOpen ? 'max-h-[600px]' : 'max-h-0'
        }`}
      >
        <div className="p-4 pl-5 pr-3 text-[13px] text-[var(--ink-secondary)] overflow-y-auto max-h-[600px]">
          {children}
        </div>
      </div>
    </div>
  );
}

interface SummaryContentProps {
  content: string;
  type: 'text' | 'bullets' | 'paragraphs';
  maxLines?: number;
}

function SummaryContent({ content, type, maxLines }: SummaryContentProps) {
  if (!content) {
    return <p className="text-[var(--ink-muted)] italic">No content available</p>;
  }

  if (type === 'bullets') {
    const rawLines = content.split('\n');
    const bulletItemsRaw: string[] = [];
    for (const itemLine of rawLines) {
      if (itemLine.trim().length > 0) bulletItemsRaw.push(itemLine);
    }
    const bulletItems = maxLines !== undefined ? bulletItemsRaw.slice(0, maxLines) : bulletItemsRaw;

    return (
      <ul className="flex flex-col gap-2">
        {bulletItems.map((item) => (
          <li key={item} className="flex gap-2.5">
            <span
              aria-hidden
              className="mt-[0.35em] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]"
            />
            <span className="leading-relaxed">{item.trim()}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (type === 'paragraphs') {
    const rawParas = content.split(/\n{2,}/);
    const paragraphsRaw: string[] = [];
    for (const pItem of rawParas) {
      const trimmed = pItem.trim();
      if (trimmed.length > 0) paragraphsRaw.push(trimmed);
    }
    const paragraphs = maxLines !== undefined ? paragraphsRaw.slice(0, maxLines) : paragraphsRaw;

    return (
      <div className="flex flex-col gap-3">
        {paragraphs.map((para) => (
          <p key={para} className="leading-relaxed">
            {para}
          </p>
        ))}
      </div>
    );
  }

  // type === 'text'
  const linesArray = content.split('\n');
  const lines = maxLines !== undefined ? linesArray.slice(0, maxLines).join('\n') : content;
  return <p className="leading-relaxed whitespace-pre-wrap">{lines}</p>;
}

function SummarySkeletons() {
  const skeletonCount = 4;
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: skeletonCount }).map((_, i) => (
        <div
          key={`skeleton-${i}`}
          className="border border-[var(--line)] rounded-lg bg-[var(--surface)] overflow-hidden"
        >
          <div className="px-4 py-3 bg-[var(--bg)] border-0 border-b border-[var(--line-faint)]">
            <Skeleton width="25%" height={12} index={i} />
          </div>
        </div>
      ))}
    </div>
  );
}
