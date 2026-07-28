'use client';

import { memo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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

function RightPanelAccordionImpl({ items }: RightPanelAccordionProps) {
  const [openStates, setOpenStates] = useState<Record<string, boolean>>(
    Object.fromEntries(items.map((item) => [item.id, item.defaultOpen || false]))
  );

  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);

  const toggleItem = (id: string) => {
    setOpenStates((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopyItem = (id: string, onAction?: (action: 'vertical' | 'left' | 'diagonal' | 'copy' | 'export') => void) => {
    onAction?.('copy');
    setCopiedItemId(id);
    setTimeout(() => setCopiedItemId(null), 2000);
  };

  return (
    <div className="flex flex-col gap-2">
      {items.map((item, index) => (
        <motion.div
          key={item.id}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.25, delay: index * 0.04 }}
          className="border border-[var(--line)] rounded-lg bg-[var(--surface)] overflow-hidden shadow-sm"
        >
          <div
            onClick={() => toggleItem(item.id)}
            className="w-full px-4 py-3 flex items-center justify-between bg-[var(--bg)] border-0 border-b border-[var(--line-faint)] cursor-pointer select-none"
          >
            <span className="text-[13px] font-semibold text-[var(--ink)] pl-1">{item.title}</span>
            
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              {item.onAction && (
                <div className="flex items-center gap-1 pr-2 border-r border-[var(--line)] mr-1">
                  <button
                    type="button"
                    onClick={() => item.onAction?.('vertical')}
                    title="Split Vertical"
                    className="p-1 bg-transparent border-0 text-[var(--ink-muted)] hover:text-[var(--accent)] cursor-pointer flex items-center justify-center transition-colors"
                  >
                    <Icon icon="solar:sidebar-minimalistic-linear" size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => item.onAction?.('left')}
                    title="Move Left"
                    className="p-1 bg-transparent border-0 text-[var(--ink-muted)] hover:text-[var(--accent)] cursor-pointer flex items-center justify-center transition-colors"
                  >
                    <Icon icon="solar:arrow-left-linear" size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => item.onAction?.('diagonal')}
                    title="Popout / Expand"
                    className="p-1 bg-transparent border-0 text-[var(--ink-muted)] hover:text-[var(--accent)] cursor-pointer flex items-center justify-center transition-colors"
                  >
                    <Icon icon="solar:square-share-line-linear" size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopyItem(item.id, item.onAction)}
                    title="Copy Markdown"
                    className={`p-1 bg-transparent border-0 cursor-pointer flex items-center justify-center transition-all ${
                      copiedItemId === item.id ? 'text-[var(--accent)] font-bold' : 'text-[var(--ink-muted)] hover:text-[var(--accent)]'
                    }`}
                  >
                    <Icon icon={copiedItemId === item.id ? "solar:check-read-linear" : "solar:copy-linear"} size={14} />
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
          <AnimatePresence initial={false}>
            {openStates[item.id] && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className="overflow-hidden p-4 pl-5 pr-3 text-[13px] text-[var(--ink-secondary)]"
              >
                {typeof item.content === 'function' ? item.content() : item.content}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      ))}
    </div>
  );
}

export const RightPanelAccordion = memo(RightPanelAccordionImpl);
