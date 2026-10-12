'use client';

import { useMemo } from 'react';
import { Markdown } from '@astryxdesign/core';
import { toShareMarkdown } from '@/lib/utils/share-markdown';

export function MarkdownRenderer({ content }: { content: string }) {
  const markdown = useMemo(() => toShareMarkdown(content), [content]);
  return (
    <div className="text-gray-800 leading-relaxed">
      <Markdown autolink="gfm">{markdown}</Markdown>
    </div>
  );
}
