'use client';

import { Icon } from '@/components/templates/_shared/primitives';

export interface DimensionDrawerProps {
  dimension: { label: string; content?: string; icon: string } | null;
  onClose: () => void;
}

export function DimensionDrawer({ dimension, onClose }: DimensionDrawerProps) {
  if (!dimension) return null;

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/40 backdrop-blur-[4px] z-[100] animate-in fade-in duration-200"
      />
      <div className="fixed right-0 top-0 bottom-0 w-[min(90vw,480px)] bg-[var(--bg)] border-l border-[var(--line)] flex flex-col z-[101] animate-in slide-in-from-right duration-300 ease-out">
        <div className="flex items-center justify-between p-4 px-5 border-b border-[var(--line)] bg-[rgb(17_20_29_/_0.6)]">
          <div className="flex items-center gap-2">
            <Icon icon={dimension.icon} size={16} />
            <span className="font-mono text-[13px] font-semibold text-[var(--ink)]">
              {dimension.label}
            </span>
          </div>
          <button
            onClick={onClose}
            title="Close"
            className="grid place-items-center w-8 h-8 rounded-lg border-none bg-transparent text-[var(--ink-secondary)] cursor-pointer transition-colors hover:text-[var(--ink)]"
          >
            <Icon icon="solar:close-circle-linear" size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 hx-custom-scrollbar">
          {dimension.content ? (
            <div className="hx-body-secondary text-[13.5px] leading-relaxed text-[var(--ink-secondary)] whitespace-pre-wrap break-words">
              {dimension.content}
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
