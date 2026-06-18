'use client';

import { useState } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';

export interface AccordionItem {
  id: string;
  title: string;
  content: React.ReactNode | (() => React.ReactNode);
  defaultOpen?: boolean;
  onAction?: (action: 'vertical' | 'left' | 'diagonal' | 'copy' | 'export') => void;
}

interface RightPanelAccordionProps {
  items: AccordionItem[];
}

export function RightPanelAccordion({ items }: RightPanelAccordionProps) {
  const [openStates, setOpenStates] = useState<Record<string, boolean>>(
    Object.fromEntries(items.map((item) => [item.id, item.defaultOpen || false]))
  );

  const toggleItem = (id: string) => {
    setOpenStates((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <div
          key={item.id}
          className="border border-[var(--line)] rounded-xl bg-[var(--surface)] overflow-hidden shadow-sm"
        >
          <div
            onClick={() => toggleItem(item.id)}
            className="w-full px-4 py-3 flex items-center justify-between bg-[var(--bg)] border-0 border-b border-[var(--line-faint)] cursor-pointer select-none"
          >
            <span className="text-[14px] font-semibold text-[var(--ink)]">{item.title}</span>
            
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              {item.onAction && (
                <div className="flex items-center gap-1 pr-2 border-r border-[var(--line)] mr-1">
                  <button
                    type="button"
                    onClick={() => item.onAction?.('vertical')}
                    title="Expand Vertically"
                    className="p-1 bg-transparent border-0 text-[var(--ink-muted)] hover:text-[var(--accent)] cursor-pointer flex items-center justify-center transition-colors"
                  >
                    <Icon icon="solar:maximize-square-minimalistic-linear" size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => item.onAction?.('left')}
                    title="Expand Left"
                    className="p-1 bg-transparent border-0 text-[var(--ink-muted)] hover:text-[var(--accent)] cursor-pointer flex items-center justify-center transition-colors"
                  >
                    <Icon icon="solar:double-alt-arrow-left-linear" size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => item.onAction?.('diagonal')}
                    title="Expand Diagonally"
                    className="p-1 bg-transparent border-0 text-[var(--ink-muted)] hover:text-[var(--accent)] cursor-pointer flex items-center justify-center transition-colors"
                  >
                    <Icon icon="solar:scale-linear" size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => item.onAction?.('copy')}
                    title="Copy"
                    className="p-1 bg-transparent border-0 text-[var(--ink-muted)] hover:text-[var(--accent)] cursor-pointer flex items-center justify-center transition-colors"
                  >
                    <Icon icon="solar:copy-linear" size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => item.onAction?.('export')}
                    title="Export"
                    className="p-1 bg-transparent border-0 text-[var(--ink-muted)] hover:text-[var(--accent)] cursor-pointer flex items-center justify-center transition-colors"
                  >
                    <Icon icon="solar:download-linear" size={14} />
                  </button>
                </div>
              )}
              
              <button
                type="button"
                onClick={() => toggleItem(item.id)}
                className="p-1 bg-transparent border-0 text-[var(--ink-muted)] hover:text-[var(--ink)] cursor-pointer flex items-center justify-center"
              >
                <Icon 
                  icon={openStates[item.id] ? "solar:alt-arrow-up-linear" : "solar:alt-arrow-down-linear"} 
                  size={16} 
                />
              </button>
            </div>
          </div>
          {openStates[item.id] && (
            <div className="p-4 text-[13px] text-[var(--ink-secondary)]">
              {typeof item.content === 'function' ? item.content() : item.content}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
