'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { preprocessMarkdown } from '@/lib/utils/format';
import { TimestampLink } from '@/components/TimestampLink';

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
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h1 className="font-mono text-[16px] font-bold text-[var(--ink)] mt-6 mb-3 pb-2 border-b border-[var(--line-faint)]">{children}</h1>,
              h2: ({ children }) => <h2 className="font-mono text-[14px] font-bold text-[var(--ink)] mt-6 mb-3 pb-1 border-b border-[var(--line-faint)]">{children}</h2>,
              h3: ({ children }) => <h3 className="font-mono text-[13px] font-bold text-[var(--ink)] mt-5 mb-2">{children}</h3>,
              h4: ({ children }) => <h4 className="font-mono text-[12px] font-bold uppercase tracking-wider text-[var(--ink-secondary)] mt-5 mb-2">{children}</h4>,
              p: ({ children }) => <p className="mb-4 leading-relaxed">{children}</p>,
              ul: ({ children }) => <ul className="list-disc list-outside pl-5 mb-4 space-y-2">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal list-outside pl-5 mb-4 space-y-2">{children}</ol>,
              li: ({ children }) => <li className="text-[13px] leading-relaxed">{children}</li>,
              strong: ({ children }) => <strong className="font-bold text-[var(--ink)]">{children}</strong>,
              em: ({ children }) => <em className="italic text-[var(--ink)]">{children}</em>,
              code: ({ children, className }) => {
                const isBlock = className?.includes('language-');
                if (isBlock) {
                  return <code className="block bg-[var(--surface)] border border-[var(--line-faint)] rounded-md p-3 font-mono text-[12px] leading-relaxed overflow-x-auto my-3">{children}</code>;
                }
                return <code className="bg-[var(--surface)] px-1.5 py-0.5 rounded font-mono text-[12px] text-[var(--ink)]">{children}</code>;
              },
              pre: ({ children }) => <pre className="bg-[var(--surface)] border border-[var(--line-faint)] rounded-md p-3 font-mono text-[12px] leading-relaxed overflow-x-auto my-3">{children}</pre>,
              table: ({ children }) => (
                <div className="my-4 rounded-md border border-[var(--line)] overflow-x-auto hx-custom-scrollbar bg-[var(--surface)]/50">
                  <table className="w-full text-[12px] border-collapse">{children}</table>
                </div>
              ),
              thead: ({ children }) => <thead className="bg-[var(--surface-raised)] border-b-2 border-[var(--line)]">{children}</thead>,
              th: ({ children }) => <th className="px-4 py-3 text-left font-mono font-bold text-[var(--ink)] text-[11px] uppercase tracking-wider border-r border-[var(--line-faint)] last:border-r-0">{children}</th>,
              td: ({ children }) => <td className="px-4 py-2.5 border-r border-[var(--line-faint)] border-b border-[var(--line-faint)] last:border-r-0">{children}</td>,
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-[var(--accent)] pl-3 my-3 text-[var(--ink-secondary)] italic">
                  {children}
                </blockquote>
              ),
              hr: () => <hr className="my-4 border-0 border-t border-[var(--line-faint)]" />,
              a: ({ children, href }) => {
                if (href?.startsWith('#t=')) {
                  const timestamp = href.replace('#t=', '');
                  return <TimestampLink timestamp={timestamp}>{children}</TimestampLink>;
                }
                return <a href={href} className="text-[var(--accent)] hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>;
              },
            }}
          >
            {preprocessMarkdown(dimension.content)}
          </ReactMarkdown>
        </div>
      ) : (
        <div className="text-[var(--ink-muted)] font-mono text-[12px] italic">
          No content available.
        </div>
      )}
    </div>
  );
}
