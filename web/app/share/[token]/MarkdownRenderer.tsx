'use client';

import { Markdown } from '@astryxdesign/core';

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="text-gray-800 leading-relaxed">
      <Markdown autolink="gfm">{content}</Markdown>
    </div>
  );
}
