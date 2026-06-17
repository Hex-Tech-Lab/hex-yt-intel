'use client';

import { Icon } from '@/components/templates/_shared/primitives';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useEffect, useRef } from 'react';
import { useUIStore } from '@/store/useUIStore';

export interface DimensionDrawerProps {
  dimension: { label: string; content?: string; icon: string } | null;
  onClose: () => void;
}

export function DimensionDrawer({ dimension, onClose }: DimensionDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const setOverlayOpen = useUIStore((s) => s.setOverlayOpen);

  useEffect(() => {
    if (!dimension) {
      setOverlayOpen(false);
      return;
    }

    setOverlayOpen(true, 'dimension-drawer');

    // Focus the close button when the drawer opens
    closeBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
      if (e.key === 'Tab' && drawerRef.current) {
        const focusableElements = drawerRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            lastElement.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === lastElement) {
            firstElement.focus();
            e.preventDefault();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      setOverlayOpen(false);
    };
  }, [dimension, onClose, setOverlayOpen]);

  if (!dimension) return null;

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/40 backdrop-blur-[4px] z-[100] animate-in fade-in duration-200"
      />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${dimension.label} details`}
        className="fixed right-0 top-0 bottom-0 w-[min(90vw,480px)] bg-[var(--bg)] border-l border-[var(--line)] flex flex-col z-[101] animate-in slide-in-from-right duration-300 ease-out"
      >
        <div className="flex items-center justify-between p-4 px-5 border-b border-[var(--line)] bg-[rgb(17_20_29_/_0.6)]">
          <div className="flex items-center gap-2">
            <Icon icon={dimension.icon} size={16} />
            <span className="font-mono text-[13px] font-semibold text-[var(--ink)]">
              {dimension.label}
            </span>
          </div>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            title="Close"
            className="grid place-items-center w-8 h-8 rounded-lg border-none bg-transparent text-[var(--ink-secondary)] cursor-pointer transition-colors hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <Icon icon="solar:close-circle-linear" size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4 hx-custom-scrollbar">
          {dimension.content ? (
            <div className="prose prose-invert max-w-none px-6 py-4">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {dimension.content}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="text-[var(--ink-muted)] font-mono text-xs">
              No content available.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
