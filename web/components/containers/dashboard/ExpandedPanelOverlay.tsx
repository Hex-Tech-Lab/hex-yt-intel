import { startTransition, useEffect, useRef, useCallback, useState } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';
import { IconButton, Divider } from '@astryxdesign/core';
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
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    onCopy(panelId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
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
      // Ownership-aware close (useUIStore fix): only clear the global
      // overlay flag if this panel still owns it, so a differently-owned
      // overlay that opened while this one was mounted (e.g.
      // DimensionDrawer) doesn't have its `inert` protection clobbered by
      // this panel's unmount.
      setOverlayOpen(false, panelId);
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
          <IconButton
            variant="ghost"
            size="sm"
            label="Copy panel content"
            tooltip="Copy"
            icon={<Icon icon={copied ? "solar:check-read-linear" : "solar:copy-linear"} size={14} />}
            onClick={handleCopy}
            className={copied ? '!border-[var(--accent)] !text-[var(--accent)] !bg-[var(--accent-a10)]' : ''}
          />

          <IconButton
            variant="ghost"
            size="sm"
            label="Export panel content"
            tooltip="Export"
            icon={<Icon icon="solar:download-linear" size={14} />}
            onClick={() => onExport(panelId)}
          />

          <Divider orientation="vertical" className="h-3 mx-1" />

          {(['vertical', 'left', 'diagonal'] as const).map((m) => (
            <IconButton
              key={m}
              variant="ghost"
              size="sm"
              label={`${m.charAt(0).toUpperCase() + m.slice(1)} mode`}
              tooltip={`${m.charAt(0).toUpperCase() + m.slice(1)} Mode`}
              icon={<Icon icon={m === 'vertical' ? 'solar:maximize-square-minimalistic-linear' : m === 'left' ? 'solar:double-alt-arrow-left-linear' : 'solar:scale-linear'} size={14} />}
              className={mode === m ? 'text-[var(--accent)]' : 'text-[var(--ink-muted)]'}
              onClick={() => startTransition(() => onModeChange(panelId, m))}
            />
          ))}

          <Divider orientation="vertical" className="h-3 mx-1" />

          <IconButton
            ref={closeBtnRef}
            variant="ghost"
            size="sm"
            label="Close panel"
            tooltip="Close overlay"
            icon={<Icon icon="solar:close-circle-linear" size={16} />}
            onClick={() => startTransition(() => handleClose())}
          />
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
