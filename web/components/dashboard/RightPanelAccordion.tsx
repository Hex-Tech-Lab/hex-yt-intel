'use client';

import { useState } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';

interface AccordionItem {
  id: string;
  title: string;
  content: React.ReactNode;
  defaultOpen?: boolean;
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
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <div
          key={item.id}
          className="border border-[var(--line)] rounded-none bg-[var(--surface)] overflow-hidden"
        >
          <button
            onClick={() => toggleItem(item.id)}
            className="w-full px-4 py-3 flex items-center justify-between bg-[var(--bg)] border-0 text-[14px] font-semibold text-[var(--ink)] cursor-pointer"
          >
            {item.title}
            <Icon 
              icon={openStates[item.id] ? "solar:alt-arrow-up-linear" : "solar:alt-arrow-down-linear"} 
              size={16} 
            />
          </button>
          {openStates[item.id] && (
            <div className="p-4 text-[13px] text-[var(--ink-secondary)]">
              {item.content}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
