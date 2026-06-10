'use client';

import { useState } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';

interface FaqItem {
  q: string;
  a: string;
}

interface FaqAccordionProps {
  items: FaqItem[];
}

export function FaqAccordion({ items }: FaqAccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 800, width: "100%" }}>
      {items.map((item, i) => {
        const isOpen = openIndex === i;
        
        return (
          <div 
            key={i} 
            style={{ 
              background: "var(--surface)", 
              border: "1px solid var(--line)", 
              borderRadius: 12, 
              overflow: "hidden",
              transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
            }}
          >
            <button
              onClick={() => setOpenIndex(isOpen ? null : i)}
              style={{
                width: "100%",
                padding: "16px 20px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                textAlign: "left",
                outline: "none"
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>
                {item.q}
              </span>
              <Icon 
                icon="solar:alt-arrow-down-linear" 
                size={16} 
                style={{ 
                  color: "var(--ink-muted)",
                  transform: isOpen ? "rotate(180deg)" : "none",
                  transition: "transform 0.3s ease"
                }} 
              />
            </button>
            
            <div style={{
              maxHeight: isOpen ? "200px" : "0",
              opacity: isOpen ? 1 : 0,
              transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              padding: isOpen ? "0 20px 20px" : "0 20px",
              pointerEvents: isOpen ? "auto" : "none"
            }}>
              <p style={{ 
                margin: 0, 
                fontSize: 14, 
                color: "var(--ink-secondary)", 
                lineHeight: 1.6,
                borderTop: "1px solid var(--line)",
                paddingTop: 12
              }}>
                {item.a}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
