'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { Tooltip, IconButton } from '@astryxdesign/core';
import { Icon } from '@/components/templates/_shared/primitives';
import { useUIStore } from '@/store/useUIStore';
import { SelectedDimensionReadout } from '@/components/dashboard/SelectedDimensionReadout';
import { STACKED_LAYOUT_QUERY } from '@/hooks/useIsStackedLayout';
import { useJevRunStore } from '@/store/useJevRunStore';
import { estimateRemainingMs, formatEta, smoothEta, type EtaState } from '@/lib/jev/eta';

export interface DimensionDrawerProps {
  /** `number` drives the K>1 "based on part of the video" badge. */
  dimension: { label: string; content?: string; icon: string; number?: number } | null;
  onClose: () => void;
}

export function DimensionDrawer({ dimension, onClose }: DimensionDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const setOverlayOpen = useUIStore((s) => s.setOverlayOpen);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTokenRef = useRef(0);
  // R3b 2.5e: while a K>1 run is in flight the panel shows chunk 0's live
  // text only; Copy stays locked until the server's reduced result lands.
  const jevRun = useJevRunStore((s) => s.run);
  const isPartialDimension = useJevRunStore((s) => dimension?.number !== undefined && s.partialDimensions.includes(dimension.number));
  const [eta, setEta] = useState<EtaState | null>(null);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!jevRun || jevRun.settled >= jevRun.total) {
      startedAtRef.current = null;
      setEta(null);
    } else {
      const isNewRun = jevRun.startedAt !== startedAtRef.current;
      startedAtRef.current = jevRun.startedAt;
      const nowTimestamp = Date.now();
      setEta((prev) => smoothEta(isNewRun ? null : prev, estimateRemainingMs(jevRun, nowTimestamp), nowTimestamp));
    }
  // Keyed on the run's identity + counts only: re-seed on settlement or a new run, never on unrelated store updates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jevRun?.startedAt, jevRun?.settled, jevRun?.total]);

  useEffect(() => {
    if (!jevRun || jevRun.settled >= jevRun.total) return;
    const ticker = setInterval(() => {
      const nowTimestamp = Date.now();
      setEta((prev) => smoothEta(prev, null, nowTimestamp));
    }, 1000);
    return () => clearInterval(ticker);
  }, [jevRun, jevRun?.settled, jevRun?.total]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleCopy = useCallback(async () => {
    if (!dimension?.content || useJevRunStore.getState().run) return;
    const token = ++copyTokenRef.current;
    try {
      await navigator.clipboard.writeText(dimension.content);
      if (copyTokenRef.current !== token) return; // dimension changed mid-copy
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      setCopyState('copied');
      copyTimeoutRef.current = setTimeout(() => setCopyState('idle'), 2000);
    } catch (err) {
      console.error('[DimensionDrawer] Clipboard copy failed', { message: err instanceof Error ? err.message : String(err) });
      if (copyTokenRef.current !== token) return;
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      setCopyState('failed');
      copyTimeoutRef.current = setTimeout(() => setCopyState('idle'), 2000);
    }
  }, [dimension]);

  useEffect(() => {
    // Dimension identity changed: invalidate any in-flight copy and reset UI.
    copyTokenRef.current++;
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    setCopyState('idle');
  }, [dimension?.label]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!dimension) {
      return;
    }

    previousFocusRef.current = document.activeElement as HTMLElement;

    requestAnimationFrame(() => closeBtnRef.current?.focus());

    // Below the xl breakpoint (Tailwind default 1280px) this drawer is a
    // full off-canvas overlay that visually covers <main>, so trapping
    // interaction there via `inert` (driven by isAnyOverlayOpen in
    // DashboardLayout) is correct. At xl+ this drawer is only ever as wide
    // as the 390px right-panel column (see `w-[min(90vw,390px)]` below) and
    // never overlaps <main> or the left sidebar -- inerting them there
    // locked the whole center panel (including video playback/scroll)
    // behind a single dimension click, which is the reported bug. Only
    // mark the global overlay open on breakpoints where it actually
    // overlays something else.
    const stackedQuery = window.matchMedia(STACKED_LAYOUT_QUERY);
    const syncOverlayForBreakpoint = () => {
      setOverlayOpen(stackedQuery.matches, 'dimension-drawer');
    };
    syncOverlayForBreakpoint();
    stackedQuery.addEventListener('change', syncOverlayForBreakpoint);

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
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (e.shiftKey) {
          if (document.activeElement === first) { last.focus(); e.preventDefault(); }
        } else {
          if (document.activeElement === last) { first.focus(); e.preventDefault(); }
        }
      }
    };

    // Close on any pointer press outside the drawer. Using a passive document
    // listener (instead of a full-screen backdrop element) lets the very same
    // press also reach the underlying UI — so tapping a *different* dimension
    // in the accordion closes this panel AND selects the new one in one gesture,
    // rather than requiring a throwaway first click to dismiss the backdrop.
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (
        drawerRef.current &&
        !drawerRef.current.contains(target) &&
        !target.closest('[data-chat-dock="true"]') &&
        !target.closest('[data-dimension-trigger="true"]')
      ) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown, { passive: true });
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
      stackedQuery.removeEventListener('change', syncOverlayForBreakpoint);
      // Ownership-aware close (useUIStore fix, PR review): pass this
      // component's own id so the store only clears the global overlay
      // flag if THIS drawer still owns it -- otherwise a second overlay
      // (e.g. ExpandedPanelOverlay) that opened while this one was mounted
      // would have its `inert` protection silently clobbered by this
      // drawer's unmount.
      setOverlayOpen(false, 'dimension-drawer');
      const prev = previousFocusRef.current;
      requestAnimationFrame(() => prev?.focus());
    };
  }, [dimension, onClose, setOverlayOpen]);

  const [drawerWidth, setDrawerWidth] = useState<number>(390);
  const isDraggingRef = useRef(false);

  // Shared clamp: min 320px, max min(80vw, 800px) — identical bounds for
  // pointer drags and keyboard resize so both input paths stay in range.
  const clampWidth = useCallback(
    (width: number) => Math.min(Math.max(width, 320), Math.min(window.innerWidth * 0.8, 800)),
    []
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      const startX = e.clientX;
      const startWidth = drawerWidth;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (!isDraggingRef.current) return;
        setDrawerWidth(clampWidth(startWidth + (startX - moveEvent.clientX)));
      };

      const handlePointerUp = () => {
        isDraggingRef.current = false;
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    },
    [drawerWidth, clampWidth]
  );

  const handleResizeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 64 : 16;
      let handled = true;
      if (e.key === 'ArrowLeft') setDrawerWidth((w) => clampWidth(w + step));
      else if (e.key === 'ArrowRight') setDrawerWidth((w) => clampWidth(w - step));
      else if (e.key === 'Home') setDrawerWidth(clampWidth(800));
      else if (e.key === 'End') setDrawerWidth(clampWidth(320));
      else handled = false;
      if (handled) e.preventDefault();
    },
    [clampWidth]
  );

  if (!dimension) return null;

  return (
    <>
      {/* Outside-click dismissal is handled by the document `pointerdown`
          listener above (not a backdrop element) so the same press can also
          land on the accordion and switch dimensions in a single click. */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${dimension.label} details`}
        style={{ width: `${drawerWidth}px`, maxWidth: '90vw' }}
        className="fixed right-0 top-0 bottom-0 bg-[var(--bg)] border-l border-[var(--line)] flex flex-col z-[101] animate-in slide-in-from-right duration-300 ease-out"
      >
        {/* Resize Handle — focusable separator: pointer drag + arrow-key
            resize (Shift = larger step), Home/End jump to max/min. */}
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="Resize panel"
          aria-valuenow={Math.round(drawerWidth)}
          aria-valuemin={320}
          aria-valuemax={Math.round(Math.min(window.innerWidth * 0.8, 800))}
          onPointerDown={handlePointerDown}
          onKeyDown={handleResizeKeyDown}
          className="absolute left-0 top-0 bottom-0 w-2 -translate-x-1 cursor-col-resize hover:bg-[var(--accent)]/30 transition-colors z-[102] focus-visible:bg-[var(--accent)]/50 focus-visible:outline-none"
          title="Drag or use arrow keys to resize panel"
        />

        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--line)] bg-[rgb(17_20_29_/_0.6)]">
          <div className="flex items-center gap-2">
            <Icon icon={dimension.icon} size={14} />
            <span className="font-mono text-[12px] font-semibold uppercase tracking-wider text-[var(--ink)]">
              {dimension.label}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <IconButton
              label={jevRun ? 'Copy unavailable until the analysis finishes' : copyState === 'copied' ? 'Copied!' : copyState === 'failed' ? 'Copy failed' : 'Copy to clipboard'}
              tooltip={jevRun ? 'Available when the analysis finishes' : copyState === 'copied' ? 'Copied!' : copyState === 'failed' ? 'Copy failed' : 'Copy to clipboard'}
              isDisabled={jevRun !== null}
              aria-disabled={jevRun !== null}
              variant="ghost"
              size="sm"
              onClick={() => { handleCopy().catch((e) => console.error('[DimensionDrawer] copy handler rejected', e)); }}
              className={
                copyState === 'copied'
                  ? '!border-green-500 !text-green-500 !bg-green-500/10'
                  : copyState === 'failed'
                    ? '!border-red-500 !text-red-500 !bg-red-500/10'
                    : ''
              }
              icon={
                <Icon
                  icon={
                    copyState === 'copied'
                      ? 'solar:check-read-linear'
                      : copyState === 'failed'
                        ? 'solar:close-circle-linear'
                        : 'solar:copy-linear'
                  }
                  size={14}
                />
              }
            />
            <Tooltip content="Close">
              <button
                ref={closeBtnRef}
                onClick={handleClose}
                aria-label="Close dimension details"
                className="grid place-items-center w-7 h-7 rounded-md border-none bg-transparent text-[var(--ink-secondary)] cursor-pointer transition-colors hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              >
                <Icon icon="solar:close-circle-linear" size={16} />
              </button>
            </Tooltip>
          </div>
        </div>

        {jevRun ? (
          <div role="status" className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--line)] bg-[var(--accent-soft,rgb(99_102_241_/_0.12))] font-mono text-[11px] uppercase tracking-wider text-[var(--ink)]">
            <span className="flex items-center gap-2">
              <Icon icon="solar:magic-stick-3-linear" size={14} />
              Applying intelligence…
            </span>
            <span className="text-[var(--ink-secondary)]">{formatEta(eta?.remainingMs ?? null)}</span>
          </div>
        ) : isPartialDimension ? (
          <div className="px-3 py-1.5 border-b border-[var(--line)] font-mono text-[11px] text-[var(--ink-secondary)]">
            Based on part of the video
          </div>
        ) : null}

        {/* Content */}
        <SelectedDimensionReadout dimension={dimension} />
      </div>
    </>
  );
}
