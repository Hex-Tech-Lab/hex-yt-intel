'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Collapsible } from '@astryxdesign/core/Collapsible';

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
          <motion.div
            key={item.q}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: i * 0.05, ease: "easeOut" }}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <Collapsible
              trigger={<span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{item.q}</span>}
              isOpen={isOpen}
              onOpenChange={(next) => setOpenIndex(next ? i : null)}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  color: "var(--ink-secondary)",
                  lineHeight: 1.6,
                  borderTop: "1px solid var(--line)",
                  paddingTop: 12,
                }}
              >
                {item.a}
              </p>
            </Collapsible>
          </motion.div>
        );
      })}
    </div>
  );
}
