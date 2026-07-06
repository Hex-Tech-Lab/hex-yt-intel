'use client';

import { useEffect, useRef, useState } from 'react';
import { MonoLabel, StatusBadge, GlowBorder, Icon, SynthesisStatus, CornerFrame } from '@/components/templates/_shared/primitives';
import { Button } from '@/components/ui/button';

export interface AnalysisHeroProps {
  url: string;
  status: SynthesisStatus;
  onUrlChange: (url: string) => void;
  onAnalyze: () => void;
  onReanalyze: () => void;
  onCancel?: () => void;
  error?: string;
  quota?: string;
}

export function AnalysisHero({ url, status, onUrlChange, onAnalyze, onReanalyze, onCancel, error, quota }: AnalysisHeroProps) {
  const streaming = status === "streaming";
  const disabled = streaming || !url || url.trim().length === 0;

  const heroRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (heroRef.current) {
      setMeasuredHeight(heroRef.current.scrollHeight);
    }
    const handleResize = () => {
      if (heroRef.current) {
        setMeasuredHeight(heroRef.current.scrollHeight);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [status]);

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  return (
    <section className="hx-rise">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <MonoLabel index="//">synthesis console</MonoLabel>
          {quota && <span className="font-mono text-[11px] text-[var(--ink-secondary)]">{quota}</span>}
        </div>
        <StatusBadge status={status} />
      </div>

      <div 
        ref={heroRef}
        className="overflow-hidden transition-[max-height,opacity] duration-300 ease-out"
        style={{ 
          maxHeight: status !== 'idle' ? '0px' : `${measuredHeight}px`, 
          opacity: status !== 'idle' ? 0 : 1, 
          marginBottom: status !== 'idle' ? 0 : 16
        }}
      >
        <h1 className="hx-h1 max-w-[20ch]">
          Drop a YouTube URL. Get a structured synthesis across 11 dimensions.
        </h1>
        <p className="hx-body-lg mt-2 max-w-[54ch]">
          Transcript, claims, frameworks, and contrarian takes, mapped into your knowledge graph and searchable in seconds.
        </p>
      </div>

      <div className="mt-4 max-w-[640px]">
        <CornerFrame tone={streaming ? "accent" : "line"}>
          <GlowBorder active={streaming} radius="control">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 bg-[var(--surface)] p-2.5 rounded-lg shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)]">
              <span aria-hidden className={`grid place-items-center w-10 h-10 rounded-lg bg-[var(--bg)] ${streaming ? 'text-[var(--accent)]' : 'text-[var(--ink-muted)]'} flex-none border border-[var(--line)]`}>
                <Icon icon="solar:link-round-angle-linear" size={20} />
              </span>
              <input
                type="url"
                value={url}
                onChange={(e) => onUrlChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !disabled) onAnalyze(); }}
                placeholder="https://youtube.com/watch?v=..."
                aria-label="YouTube video URL"
                aria-invalid={status === "error"}
                aria-describedby={status === "error" ? "hero-error" : undefined}
                className="hx-field min-w-[140px] flex-1 bg-transparent border-none outline-none px-1 font-mono text-sm text-[var(--ink)]"
              />
              {url && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    title="Copy URL"
                    onClick={handleCopy}
                    className={`bg-transparent border-none ${copied ? 'text-[var(--accent)]' : 'text-[var(--ink-muted)]'} cursor-pointer p-1.5 flex items-center justify-center rounded-md transition-colors duration-[var(--dur-fast)]`}
                  >
                    <Icon icon={copied ? "solar:check-read-linear" : "solar:copy-linear"} size={16} />
                  </button>
                  <button
                    type="button"
                    title="Clear input"
                    onClick={() => onUrlChange('')}
                    className="bg-transparent border-none text-[var(--ink-muted)] cursor-pointer p-1.5 flex items-center justify-center rounded-md transition-colors duration-[var(--dur-fast)]"
                  >
                    <Icon icon="solar:close-circle-linear" size={16} />
                  </button>
                </div>
              )}
              <div className="flex gap-2 flex-shrink-0">
                {status === "done" && (
                  <Button type="button" variant="outline" size="md" title="Re-analyze this video (bypasses cache)" onClick={onReanalyze}>
                    <Icon icon="solar:refresh-linear" size={16} />
                    Re-analyze
                  </Button>
                )}
                {streaming && onCancel && (
                  <Button type="button" variant="danger" size="icon" title="Cancel analysis" onClick={onCancel}>
                    <Icon icon="solar:stop-circle-linear" size={16} />
                  </Button>
                )}
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={onAnalyze}
                  disabled={disabled}
                >
                  <Icon
                    icon={streaming ? "solar:refresh-linear" : "solar:bolt-linear"}
                    size={16}
                    className={streaming ? "hx-anispin" : ""}
                  />
                  {streaming ? "Analyzing" : "Analyze"}
                </Button>
              </div>
            </div>
          </GlowBorder>
        </CornerFrame>
      </div>

      <div className="mt-2 flex min-h-5 max-w-[640px] items-center text-xs">
        <span id="hero-error" role="alert" aria-live="assertive" className="font-mono text-[var(--err)] font-medium">{status === "error" ? error : ""}</span>
      </div>
    </section>
  );
}
