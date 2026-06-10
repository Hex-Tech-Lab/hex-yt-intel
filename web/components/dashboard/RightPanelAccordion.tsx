'use client';

import { useState } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';

interface AccordionItem {
  title: string;
  content: React.ReactNode;
  defaultOpen?: boolean;
}

interface RightPanelAccordionProps {
  items: AccordionItem[];
}

export function RightPanelAccordion({ items }: RightPanelAccordionProps) {
  const [openStates, setOpenStates] = useState<boolean[]>(
    items.map((item) => item.defaultOpen || false)
  );

  const toggleItem = (index: number) => {
    const newStates = [...openStates];
    newStates[index] = !newStates[index];
    setOpenStates(newStates);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((item, index) => (
        <div
          key={index}
          style={{
            border: "1px solid var(--line)",
            borderRadius: 0, // Enforcing strict 0px border-radius
            background: "var(--surface)",
            overflow: "hidden",
          }}
        >
          <button
            onClick={() => toggleItem(index)}
            style={{
              width: "100%",
              padding: "12px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "var(--bg)",
              border: "none",
              color: "var(--ink)",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {item.title}
            <Icon 
              icon={openStates[index] ? "solar:alt-arrow-up-linear" : "solar:alt-arrow-down-linear"} 
              size={16} 
            />
          </button>
          {openStates[index] && (
            <div style={{ padding: 16, color: "var(--ink-secondary)", fontSize: 13 }}>
              {item.content}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
