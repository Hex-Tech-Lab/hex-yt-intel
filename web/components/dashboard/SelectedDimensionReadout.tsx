'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface SelectedDimensionReadoutProps {
  dimension: { label: string; content?: string; icon: string } | null;
}

export function SelectedDimensionReadout({ dimension }: SelectedDimensionReadoutProps) {
  if (!dimension) return null;

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3 hx-custom-scrollbar">
      {dimension.content ? (
        <div className="text-[14px] leading-relaxed text-[var(--ink-secondary)]">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h1 className="font-mono text-[16px] font-bold text-[var(--ink)] mt-4 mb-2 pb-2 border-b border-[var(--line-faint)]">{children}</h1>,
              h2: ({ children }) => <h2 className="font-mono text-[14px] font-bold text-[var(--ink)] mt-4 mb-2 pb-1 border-b border-[var(--line-faint)]">{children}</h2>,
              h3: ({ children }) => <h3 className="font-mono text-[13px] font-bold text-[var(--ink)] mt-3 mb-1">{children}</h3>,
              h4: ({ children }) => <h4 className="font-mono text-[12px] font-bold uppercase tracking-wider text-[var(--ink-secondary)] mt-3 mb-1">{children}</h4>,
              p: ({ children }) => <p className="mb-2 leading-relaxed">{children}</p>,
              ul: ({ children }) => <ul className="list-disc list-outside pl-5 mb-2 space-y-0.5">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal list-outside pl-5 mb-2 space-y-0.5">{children}</ol>,
              li: ({ children }) => <li className="text-[13px] leading-relaxed">{children}</li>,
              strong: ({ children }) => <strong className="font-bold text-[var(--ink)]">{children}</strong>,
              em: ({ children }) => <em className="italic text-[var(--ink)]">{children}</em>,
              code: ({ children, className }) => {
                const isBlock = className?.includes('language-');
                if (isBlock) {
                  return <code className="block bg-[var(--surface)] border border-[var(--line-faint)] rounded-md p-3 font-mono text-[12px] leading-relaxed overflow-x-auto my-2">{children}</code>;
                }
                return <code className="bg-[var(--surface)] px-1.5 py-0.5 rounded font-mono text-[12px] text-[var(--ink)]">{children}</code>;
              },
              pre: ({ children }) => <pre className="bg-[var(--surface)] border border-[var(--line-faint)] rounded-md p-3 font-mono text-[12px] leading-relaxed overflow-x-auto my-2">{children}</pre>,
              table: ({ children }) => (
                <div className="my-3 rounded-md border border-[var(--line-faint)] overflow-hidden">
                  <table className="w-full text-[12px] border-collapse">{children}</table>
                </div>
              ),
              thead: ({ children }) => <thead className="bg-[var(--surface)] border-b border-[var(--line-faint)]">{children}</thead>,
              th: ({ children }) => <th className="px-3 py-2 text-left font-mono font-bold text-[var(--ink)] text-[11px] uppercase tracking-wider">{children}</th>,
              td: ({ children }) => <td className="px-3 py-2 border-b border-[var(--line-faint)] last:border-b-0">{children}</td>,
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-[var(--accent)] pl-3 my-2 text-[var(--ink-secondary)] italic">
                  {children}
                </blockquote>
              ),
              hr: () => <hr className="my-3 border-0 border-t border-[var(--line-faint)]" />,
              a: ({ children, href }) => <a href={href} className="text-[var(--accent)] hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
            }}
          >
            {dimension.content}
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
