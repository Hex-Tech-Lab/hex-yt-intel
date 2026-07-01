'use client';

import { useState, useMemo } from 'react';
import { MonoLabel, GlowBorder, Icon, CornerFrame } from '@/components/templates/_shared/primitives';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Dimension } from './StreamingGrid';

interface ApexSummaryCardProps {
  dimension: Dimension;
}

type SummaryTab = 'executive' | 'short' | 'long';

export function ApexSummaryCard({ dimension }: ApexSummaryCardProps) {
  const [activeTab, setActiveTab] = useState<SummaryTab>('executive');
  const { status, content = '' } = dimension;
  const streaming = status === "streaming";

  const parsedSummaries = useMemo(() => {
    const summaries: Record<SummaryTab, string> = {
      executive: '',
      short: '',
      long: ''
    };

    if (!content) return summaries;

    // Helper to get Core Thesis or first paragraph to avoid duplicate logic
    const getThesisOrFirstParagraph = (text: string, limit: number): string => {
      const match = text.match(/(?:The Core Thesis:|Core Thesis:)\s*([^\n]+)/i);
      if (match && match[1]) {
        return `**Core Thesis:** ${match[1].trim()}`;
      }
      const paragraphs = text.split('\n\n').filter(p => p.trim().length > 0);
      return paragraphs[0] || text.slice(0, limit);
    };

    // Helper to extract sections between markers
    const extract = (tag: string) => {
      const startTag = `#### [${tag}]`;
      const startIdx = content.indexOf(startTag);
      if (startIdx === -1) return '';
      
      const rest = content.slice(startIdx + startTag.length);
      const nextHeaderIdx = rest.indexOf('\n#### [');
      const nextDoubleHashIdx = rest.indexOf('\n### ');
      
      let endIdx = rest.length;
      if (nextHeaderIdx !== -1 && nextDoubleHashIdx !== -1) {
        endIdx = Math.min(nextHeaderIdx, nextDoubleHashIdx);
      } else if (nextHeaderIdx !== -1) {
        endIdx = nextHeaderIdx;
      } else if (nextDoubleHashIdx !== -1) {
        endIdx = nextDoubleHashIdx;
      }

      return rest.slice(0, endIdx).trim();
    };

    summaries.executive = extract('EXECUTIVE_SUMMARY');
    summaries.short = extract('SHORT_SUMMARY');
    summaries.long = extract('LONG_SUMMARY');

    // Fallback if tags not found (legacy or early stream)
    if (!summaries.executive && !summaries.short && !summaries.long) {
       summaries.executive = content;
       summaries.short = getThesisOrFirstParagraph(content, 300);
       summaries.long = content;
    }

    // Individual fallbacks for done state if still empty
    if (status === "done") {
      if (!summaries.executive) summaries.executive = content;
      if (!summaries.short) {
        summaries.short = getThesisOrFirstParagraph(content, 400);
      }
      if (!summaries.long) summaries.long = content;
    }

    return summaries;
  }, [content, status]);

  const tabs: { key: SummaryTab; label: string; icon: string }[] = [
    { key: 'executive', label: 'Executive', icon: 'solar:case-linear' },
    { key: 'short', label: 'Short', icon: 'solar:notes-linear' },
    { key: 'long', label: 'Long', icon: 'solar:document-text-linear' },
  ];

  return (
    <GlowBorder
      active={streaming}
      radius="card"
      style={{ gridColumn: "1 / -1" }} // Span full width
    >
      <CornerFrame tone={streaming ? "accent" : "line"}>
        <article
          className={`bg-[var(--surface)] p-6 rounded-2xl border border-[var(--line-faint)] min-h-[320px] flex flex-col ${streaming ? "animate-flare" : ""}`}
        >
          <header className="flex items-center justify-between mb-6">
            <div className="flex flex-col gap-1">
              <MonoLabel index="01">Apex Intelligence</MonoLabel>
              <h2 className="text-xl font-semibold tracking-tight text-[var(--ink)]">Synthesis Overview</h2>
            </div>
            
            <div className="flex gap-1 p-1 rounded-xl border border-[var(--line)] bg-[rgb(11_14_20_/_0.5)]">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-none cursor-pointer font-mono text-[10px] font-bold uppercase tracking-wider transition-all ${
                    activeTab === t.key ? 'bg-[var(--accent)] text-[var(--void)] shadow-lg' : 'bg-transparent text-[var(--ink-muted)] hover:text-[var(--ink-secondary)]'
                  }`}
                >
                  <Icon icon={t.icon} size={14} />
                  {t.label}
                </button>
              ))}
            </div>
          </header>

          <div className="flex-1 overflow-y-auto max-h-[500px] hx-custom-scrollbar pr-2">
            {status === "done" || (status === "streaming" && parsedSummaries[activeTab]) ? (
              <div className="prose prose-invert max-w-none prose-p:text-sm prose-p:leading-relaxed prose-headings:text-base prose-headings:mt-4 prose-headings:mb-2">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {parsedSummaries[activeTab] || `*Waiting for ${activeTab} summary layer...*`}
                </ReactMarkdown>
              </div>
            ) : status === "error" ? (
              <div className="flex flex-col items-center justify-center py-12 text-[var(--err)] opacity-80">
                <Icon icon="solar:danger-triangle-linear" size={32} className="mb-2" />
                <p className="font-mono text-xs">Synthesis failure in Apex layer. Retry available.</p>
              </div>
            ) : (
              <div className="space-y-4 animate-pulse pt-4">
                <div className="h-4 bg-[var(--line-strong)] rounded w-3/4 opacity-20" />
                <div className="h-4 bg-[var(--line-strong)] rounded w-1/2 opacity-15" />
                <div className="h-4 bg-[var(--line-strong)] rounded w-5/6 opacity-10" />
                <div className="h-24 bg-[var(--line-strong)] rounded w-full opacity-5 mt-8" />
              </div>
            )}
          </div>
          
          <footer className="mt-6 pt-4 border-t border-[var(--line-faint)] flex items-center justify-between">
             <div className="flex items-center gap-4 text-[10px] font-mono text-[var(--ink-muted)] uppercase tracking-widest">
                <span className="flex items-center gap-1.5">
                   <span className={`w-1.5 h-1.5 rounded-full ${streaming ? 'bg-[var(--accent)] animate-pulse' : 'bg-[var(--ok)]'}`} />
                   {status}
                </span>
                <span>Tier: Pro Verified</span>
             </div>
             <div className="flex gap-2">
                <button className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--bg)] border border-[var(--line)] text-[var(--ink-muted)] text-[10px] hover:text-[var(--accent)] transition-colors">
                   <Icon icon="solar:share-linear" size={12} /> Share
                </button>
             </div>
          </footer>
        </article>
      </CornerFrame>
    </GlowBorder>
  );
}