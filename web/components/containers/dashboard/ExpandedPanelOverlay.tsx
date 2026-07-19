'use client';

import { startTransition, useEffect, useRef, useCallback } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';
import { KnowledgeGraphCanvas } from '@/components/templates/console/KnowledgeGraphCanvas';
import { useUIStore } from '@/store/useUIStore';
import type { KnowledgeGraph } from '@/lib/types/knowledge-graph';

export type ExpandedPanelMode = 'vertical' | 'left' | 'diagonal';

interface ExpandedPanelOverlayProps {
  panelId: string;
  mode: ExpandedPanelMode;
  title: string;
  graph: KnowledgeGraph;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onFocusNode: (id: string) => void;
  onCopy: (id: string) => void;
  onExport: (id: string) => void;
  onModeChange: (id: string, mode: ExpandedPanelMode) => void;
  onClose: () => void;
  content: () => React.ReactNode;
}

function getPositioning(mode: ExpandedPanelMode): React.CSSProperties {
  if (mode === 'vertical') {
    return { position: 'absolute', right: '8px', top: '8px', bottom: '8px', width: '390px', zIndex: 60 };
  }
  if (mode === 'left') {
    return { position: 'absolute', left: '280px', width: 'calc(100% - 280px - 414px)', top: '400px', bottom: '100px', zIndex: 60 };
  }
  return { position: 'absolute', left: '280px', right: '20px', top: '400px', bottom: '100px', zIndex: 60 };
}

export function ExpandedPanelOverlay({
  panelId,
  mode,
  title,
  graph,
  selectedNodeId,
  onSelectNode,
  onFocusNode,
  onCopy,
  onExport,
  onModeChange,
  onClose,
  content,
}: ExpandedPanelOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const setOverlayOpen = useUIStore((s) => s.setOverlayOpen);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;

    requestAnimationFrame(() => closeBtnRef.current?.focus());

    // Set overlay open after mount to avoid inert double-click trap
    setOverlayOpen(true, panelId);

    const keyHandlers: Record<string, () => void> = {
      Escape: () => handleClose(),
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const handler = keyHandlers[e.key];
      if (handler) {
        e.stopPropagation();
        handler();
        return;
      }
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
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

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (panelRef.current && !panelRef.current.contains(target) && !target.closest('[data-chat-dock="true"]')) {
        handleClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown, { passive: true });
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
      setOverlayOpen(false);
      const prev = previousFocusRef.current;
      requestAnimationFrame(() => prev?.focus());
    };
  }, [handleClose, panelId, setOverlayOpen]);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${title} expanded panel`}
      style={getPositioning(mode)}
      className="border border-[var(--line-strong)] bg-[rgba(15,20,30,0.95)] backdrop-blur-xl rounded-xl shadow-[0_0_50px_rgba(0,0,0,0.8),0_0_1px_rgba(0,242,254,0.15)] flex flex-col min-h-0 overflow-hidden"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--line)] bg-[rgba(20,25,35,0.4)]">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
          <h3 className="font-mono text-[11px] uppercase tracking-wider font-bold text-[var(--ink)]">
            Expanded View: {title}
          </h3>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onCopy(panelId)}
            aria-label="Copy panel content"
            title="Copy"
            className="p-1 bg-transparent border-0 text-[var(--ink-muted)] hover:text-[var(--accent)] cursor-pointer flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <Icon icon="solar:copy-linear" size={14} />
          </button>

          <button
            type="button"
            onClick={() => onExport(panelId)}
            aria-label="Export panel content"
            title="Export"
            className="p-1 bg-transparent border-0 text-[var(--ink-muted)] hover:text-[var(--accent)] cursor-pointer flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <Icon icon="solar:download-linear" size={14} />
          </button>

          <div className="w-[1px] h-3 bg-[var(--line)] mx-1" />

          {(['vertical', 'left', 'diagonal'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => startTransition(() => onModeChange(panelId, m))}
              aria-label={`${m.charAt(0).toUpperCase() + m.slice(1)} mode`}
              title={`${m.charAt(0).toUpperCase() + m.slice(1)} Mode`}
              className={`p-1 bg-transparent border-0 cursor-pointer flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                mode === m ? 'text-[var(--accent)]' : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
              }`}
            >
              <Icon icon={m === 'vertical' ? 'solar:maximize-square-minimalistic-linear' : m === 'left' ? 'solar:double-alt-arrow-left-linear' : 'solar:scale-linear'} size={14} />
            </button>
          ))}

          <div className="w-[1px] h-3 bg-[var(--line)] mx-1" />

          <button
            ref={closeBtnRef}
            type="button"
            onClick={() => startTransition(() => handleClose())}
            aria-label="Close panel"
            title="Close overlay"
            className="p-1 bg-transparent border-0 text-[var(--ink-muted)] hover:text-[var(--err)] cursor-pointer flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <Icon icon="solar:close-circle-linear" size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 hx-custom-scrollbar">
        {panelId === 'knowledge-graph' ? (
          <KnowledgeGraphCanvas graph={graph} selectedId={selectedNodeId} onSelect={onSelectNode} onFocus={onFocusNode} compact={false} />
        ) : (
          content()
        )}
      </div>
    </div>
  );
}
