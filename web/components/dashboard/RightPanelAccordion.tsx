'use client';

import { memo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Switch, IconButton } from '@astryxdesign/core';
import { Icon } from '@/components/templates/_shared/primitives';
import { useVideoStore } from '@/store/useVideoStore';

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
  const entityTimeSeekEnabled = useVideoStore((s) => s.entityTimeSeekEnabled);
  const setEntityTimeSeekEnabled = useVideoStore((s) => s.setEntityTimeSeekEnabled);

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
      <div className="flex items-center justify-between px-3.5 py-2.5 border border-[var(--line)] rounded-lg bg-[var(--surface)] text-xs shadow-sm">
        <Switch
          label="Entity Click Time-Seek"
          description="Seek the video when clicking entities in Knowledge Graph, Mind Map, or Word Cloud"
          value={entityTimeSeekEnabled}
          onChange={(checked) => setEntityTimeSeekEnabled(checked)}
          labelIcon={<Icon icon="solar:clock-circle-linear" size={14} className="text-[var(--accent)]" />}
        />
      </div>
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
                  <IconButton
                    label="Split Vertical"
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon="solar:sidebar-minimalistic-linear" size={14} />}
                    onClick={() => item.onAction?.('vertical')}
                  />
                  <IconButton
                    label="Move Left"
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon="solar:arrow-left-linear" size={14} />}
                    onClick={() => item.onAction?.('left')}
                  />
                  <IconButton
                    label="Popout / Expand"
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon="solar:square-share-line-linear" size={14} />}
                    onClick={() => item.onAction?.('diagonal')}
                  />
                  <IconButton
                    label="Copy Markdown"
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon={copiedItemId === item.id ? "solar:check-read-linear" : "solar:copy-linear"} size={14} />}
                    onClick={() => handleCopyItem(item.id, item.onAction)}
                  />
                  <IconButton
                    label="Export"
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon="solar:download-linear" size={14} />}
                    onClick={() => item.onAction?.('export')}
                  />
                </div>
              )}

              <IconButton
                label={openStates[item.id] ? 'Collapse' : 'Expand'}
                variant="ghost"
                size="sm"
                icon={<Icon icon={openStates[item.id] ? "solar:alt-arrow-up-linear" : "solar:alt-arrow-down-linear"} size={16} />}
                onClick={() => toggleItem(item.id)}
              />
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
