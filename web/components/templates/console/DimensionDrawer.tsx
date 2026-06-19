'use client';

import { Icon } from '@/components/templates/_shared/primitives';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useEffect, useRef, useCallback } from 'react';
import { useUIStore } from '@/store/useUIStore';

export interface DimensionDrawerProps {
  dimension: { label: string; content?: string; icon: string } | null;
  onClose: () => void;
}

export function DimensionDrawer({ dimension, onClose }: DimensionDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const setOverlayOpen = useUIStore((s) => s.setOverlayOpen);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!dimension) {
      setOverlayOpen(false);
      return;
    }

    setOverlayOpen(true, 'dimension-drawer');
    previousFocusRef.current = document.activeElement as HTMLElement;

    requestAnimationFrame(() => closeBtnRef.current?.focus());

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab' && drawerRef.current) {
        const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (e.shiftKey) {
          if (document.activeElement === first) { last.focus(); e.preventDefault(); }
        } else {
          if (document.activeElement === last) { first.focus(); e.preventDefault(); }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      setOverlayOpen(false);
      const prev = previousFocusRef.current;
      requestAnimationFrame(() => prev?.focus());
    };
  }, [dimension, onClose, setOverlayOpen]);

  if (!dimension) return null;

  return (
    <>
      {/* Transparent backdrop — catches outside clicks, no dimming */}
      <div
        onClick={handleClose}
        className="fixed inset-0 z-[100]"
        style={{ background: 'transparent' }}
      />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${dimension.label} details`}
        className="fixed right-0 top-0 bottom-0 w-[min(90vw,480px)] bg-[var(--bg)] border-l border-[var(--line)] flex flex-col z-[101] animate-in slide-in-from-right duration-300 ease-out"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--line)] bg-[rgb(17_20_29_/_0.6)]">
          <div className="flex items-center gap-2">
            <Icon icon={dimension.icon} size={14} />
            <span className="font-mono text-[12px] font-semibold uppercase tracking-wider text-[var(--ink)]">
              {dimension.label}
            </span>
          </div>
          <button
            ref={closeBtnRef}
            onClick={handleClose}
            title="Close"
            className="grid place-items-center w-7 h-7 rounded-md border-none bg-transparent text-[var(--ink-secondary)] cursor-pointer transition-colors hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <Icon icon="solar:close-circle-linear" size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3 hx-custom-scrollbar">
          {dimension.content ? (
            <div className="text-[14px] leading-relaxed text-[var(--ink-secondary)]">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => <h1 className="font-mono text-[16px] font-bold text-[var(--ink)] mt-4 mb-2 pb-2 border-b border-[var(--line-faint)]">{children}</h1>,
                  h2: ({ children }) => <h2 className="font-mono text-[14px] font-bold text-[var(--ink)] mt-4 mb-2 pb-1 border-b border-[var(--line-faint)]">{children}</h2>,
                  h3: ({ children }) => <h3 className="font-mono text-[13px] font-bold text-[var(--ink)] mt-3 mb-1">{children}</h3>,
                  h4: ({ children }) => <h4 className="font-mono text-[12px] font-bold uppercase tracking-wider text-[var(--ink-secondary)] mt-3 mb-1">{children}</h4>,
                  p: ({ children }) => <p className="mb-2 leading-relaxed">{children}</p>,
                  ul: ({ children }) => <ul className="list-disc list-outside pl-5 mb-2 space-y-0.5">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal list-outside pl-5 mb-2 space-y-0.5">{children}</ol>,
                  li: ({ children }) => <li className="text-[13px] leading-relaxed">{children}</li>,
                  strong: ({ children }) => <strong className="font-bold text-[var(--ink)]">{children}</strong>,
                  em: ({ children }) => <em className="italic text-[var(--ink)]">{children}</em>,
                  code: ({ children, className }) => {
                    const isBlock = className?.includes('language-');
                    if (isBlock) {
                      return <code className="block bg-[var(--surface)] border border-[var(--line-faint)] rounded-md p-3 font-mono text-[12px] leading-relaxed overflow-x-auto my-2">{children}</code>;
                    }
                    return <code className="bg-[var(--surface)] px-1.5 py-0.5 rounded font-mono text-[12px] text-[var(--ink)]">{children}</code>;
                  },
                  pre: ({ children }) => <pre className="bg-[var(--surface)] border border-[var(--line-faint)] rounded-md p-3 font-mono text-[12px] leading-relaxed overflow-x-auto my-2">{children}</pre>,
                  table: ({ children }) => (
                    <div className="my-3 rounded-md border border-[var(--line-faint)] overflow-hidden">
                      <table className="w-full text-[12px] border-collapse">{children}</table>
                    </div>
                  ),
                  thead: ({ children }) => <thead className="bg-[var(--surface)] border-b border-[var(--line-faint)]">{children}</thead>,
                  th: ({ children }) => <th className="px-3 py-2 text-left font-mono font-bold text-[var(--ink)] text-[11px] uppercase tracking-wider">{children}</th>,
                  td: ({ children }) => <td className="px-3 py-2 border-b border-[var(--line-faint)] last:border-b-0">{children}</td>,
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-2 border-[var(--accent)] pl-3 my-2 text-[var(--ink-secondary)] italic">
                      {children}
                    </blockquote>
                  ),
                  hr: () => <hr className="my-3 border-0 border-t border-[var(--line-faint)]" />,
                  a: ({ children, href }) => <a href={href} className="text-[var(--accent)] hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
                }}
              >
                {dimension.content}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="text-[var(--ink-muted)] font-mono text-[12px] italic">
              No content available.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
