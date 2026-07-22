'use client';

import { useEffect, useRef, useState } from 'react';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { Icon } from '@/components/templates/_shared/primitives';
import { showToast } from '@/lib/dashboard/export';

export interface ProcessingLogProps {
  status: 'idle' | 'streaming' | 'done' | 'error';
}

export function ProcessingLog({ status }: ProcessingLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { terminalLines } = useAnalysisStore();
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (status === 'streaming') setCollapsed(false);
  }, [status]);

  useEffect(() => {
    if (scrollRef.current && !collapsed) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [terminalLines, collapsed]);

  const handleCopy = async () => {
    const text = terminalLines.map(l => `[${l.timestamp}] ${l.message}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showToast('Log copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error(e);
      showToast('Failed to copy log.', 'error');
    }
  };

  const handleDownload = (format: 'md' | 'json') => {
    const content = format === 'md' 
      ? terminalLines.map(l => `* [${l.timestamp}] ${l.message}`).join('\n')
      : JSON.stringify(terminalLines, null, 2);
    
    const blob = new Blob([content], { type: format === 'md' ? 'text/markdown' : 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `synthesis-log.${format}`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  return (
    <div className="border border-[var(--line)] rounded-xl overflow-hidden bg-[rgb(11_14_20_/_0.96)] backdrop-blur-md shadow-[0_4px_20px_-5px_rgba(0,0,0,0.5)]">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-[var(--line)] bg-[rgb(26_31_43_/_0.7)]">
        <div className="flex gap-1.5 items-center">
          <span className="w-2 h-2 rounded-full bg-[rgb(239_68_68_/_0.8)]" />
          <span className="w-2 h-2 rounded-full bg-[rgb(245_158_11_/_0.8)]" />
          <span className="w-2 h-2 rounded-full bg-[rgb(34_197_94_/_0.8)]" />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-[var(--ink-muted)] ml-2">
            synthesis.log
          </span>
        </div>
        
        <div className="flex items-center gap-2.5">
          {status === 'streaming' && (
            <span className="font-mono text-[10px] text-[var(--accent-ink)] flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-[hx-blink_1.2s_infinite]" />
              LIVE
            </span>
          )}
          
          <button type="button" onClick={handleCopy} aria-label="Copy logs" title="Copy logs" className={`bg-transparent border-none cursor-pointer transition-colors ${copied ? 'text-[var(--accent)]' : 'text-[var(--ink-muted)]'}`}><Icon icon={copied ? 'solar:check-read-linear' : 'solar:copy-linear'} size={14} /></button>
          <button type="button" onClick={() => handleDownload('md')} aria-label="Download MD" title="Download MD" className="bg-transparent border-none text-[var(--ink-muted)] cursor-pointer"><Icon icon="solar:download-linear" size={14} /></button>
          
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand processing log' : 'Collapse processing log'}
            aria-expanded={!collapsed}
            className="grid place-items-center w-[22px] h-[22px] rounded-md border border-[var(--line)] bg-transparent text-[var(--ink-secondary)] cursor-pointer transition-all duration-150"
          >
            <Icon icon={collapsed ? 'solar:alt-arrow-up-linear' : 'solar:alt-arrow-down-linear'} size={12} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div
          ref={scrollRef}
          className="hx-custom-scrollbar p-[10px_14px] font-mono text-[11.5px] leading-[1.6] max-h-[160px] overflow-y-auto scroll-smooth"
        >
          {terminalLines.length === 0 ? (
            <div className="text-[var(--ink-muted)] italic text-[11px]">
              Initializing analysis pipeline...
            </div>
          ) : (
            terminalLines.map((line, i) => (
              <div key={`${line.timestamp}-${i}`} className="flex gap-3 mb-0.5">
                <span className="text-[var(--ink-muted)] flex-shrink-0">[{line.timestamp}]</span>
                <span className={`break-all ${line.type === 'ok' ? "text-[var(--ok)]" : line.type === 'error' ? "text-[var(--err)]" : "text-[var(--ink-secondary)]"}`}>
                  {line.message}
                </span>
              </div>
            ))
          )}
          {status === 'streaming' && (
            <div className="mt-0.5">
              <span className="inline-block w-1.5 h-3 bg-[var(--accent)] align-[-1.5px] animate-[hx-blink_1s_step-end_infinite]" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}