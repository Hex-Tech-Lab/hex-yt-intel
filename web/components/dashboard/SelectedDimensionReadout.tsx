'use client';

import type React from 'react';
import { Markdown } from '@astryxdesign/core';
import { preprocessMarkdown } from '@/lib/utils/format';
import { TimestampLink } from '@/components/TimestampLink';

const HEADING_CLASS: Record<1 | 2 | 3 | 4 | 5 | 6, string> = {
  1: 'font-mono text-[16px] font-bold text-[var(--ink)] mt-6 mb-3 pb-2 border-b border-[var(--line-faint)]',
  2: 'font-mono text-[14px] font-bold text-[var(--ink)] mt-6 mb-3 pb-1 border-b border-[var(--line-faint)]',
  3: 'font-mono text-[13px] font-bold text-[var(--ink)] mt-5 mb-2',
  4: 'font-mono text-[12px] font-bold uppercase tracking-wider text-[var(--ink-secondary)] mt-5 mb-2',
  5: 'font-mono text-[12px] font-bold uppercase tracking-wider text-[var(--ink-secondary)] mt-5 mb-2',
  6: 'font-mono text-[12px] font-bold uppercase tracking-wider text-[var(--ink-secondary)] mt-5 mb-2',
};

const readoutComponents = {
  heading: ({ level, children }: { level: 1 | 2 | 3 | 4 | 5 | 6; children: React.ReactNode }) => {
    const Tag = `h${level}` as const;
    return <Tag className={HEADING_CLASS[level]}>{children}</Tag>;
  },
  paragraph: ({ children }: { children: React.ReactNode }) => <p className="mb-4 leading-relaxed">{children}</p>,
  code: ({ code, language }: { code: string; language?: string }) => (
    <pre className="bg-[var(--surface)] border border-[var(--line-faint)] rounded-md p-3 font-mono text-[12px] leading-relaxed overflow-x-auto my-3">
      <code className={language ? `language-${language}` : undefined}>{code}</code>
    </pre>
  ),
  inlineCode: ({ children }: { children: string }) => (
    <code className="bg-[var(--surface)] px-1.5 py-0.5 rounded font-mono text-[12px] text-[var(--ink)]">{children}</code>
  ),
  blockquote: ({ children }: { children: React.ReactNode }) => (
    <blockquote className="border-l-2 border-[var(--accent)] pl-3 my-3 text-[var(--ink-secondary)] italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-0 border-t border-[var(--line-faint)]" />,
  link: ({ href, children }: { href: string; children: React.ReactNode }) => {
    if (href?.startsWith('#t=')) {
      const timestamp = href.replace('#t=', '');
      return <TimestampLink timestamp={timestamp}>{children}</TimestampLink>;
    }
    return <a href={href} className="text-[var(--accent)] hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>;
  },
};

interface SelectedDimensionReadoutProps {
  dimension: { label: string; content?: string; icon: string } | null;
}

export function SelectedDimensionReadout({ dimension }: SelectedDimensionReadoutProps) {
  if (!dimension) {
    return (
      <div className="flex-1 overflow-y-auto px-3 py-4 flex flex-col items-center justify-center text-center gap-2 h-full">
        <div className="text-[var(--ink-secondary)] font-mono text-[13px] font-semibold">
          Select a dimension to view details.
        </div>
        <div className="text-[var(--ink-muted)] text-[12px] leading-relaxed max-w-[280px]">
          Choose an item from the list to see its structured analysis details here.
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-4 hx-custom-scrollbar">
      {dimension.content ? (
        <div className="text-[14px] leading-relaxed text-[var(--ink-secondary)]">
          <Markdown components={readoutComponents}>
            {preprocessMarkdown(dimension.content)}
          </Markdown>
        </div>
      ) : (
        <div className="text-[var(--ink-muted)] font-mono text-[12px] italic">
          No content available.
        </div>
      )}
    </div>
  );
}
