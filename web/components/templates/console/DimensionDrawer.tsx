'use client';

import { Icon } from '@/components/templates/_shared/primitives';
import { useEffect, useRef, useCallback } from 'react';
import { useUIStore } from '@/store/useUIStore';
import { SelectedDimensionReadout } from '@/components/dashboard/SelectedDimensionReadout';

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

    const keyHandlers: Record<string, () => void> = {
      Escape: () => onClose(),
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const handler = keyHandlers[e.key];
      if (handler) {
        e.stopPropagation();
        handler();
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
        <SelectedDimensionReadout dimension={dimension} />
      </div>
    </>
  );
}
