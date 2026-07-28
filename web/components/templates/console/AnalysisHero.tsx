'use client';

import { useState, ViewTransition } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@astryxdesign/core/Button';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { MonoLabel, StatusBadge, GlowBorder, Icon, SynthesisStatus, CornerFrame } from '@/components/templates/_shared/primitives';
import { showToast } from '@/lib/dashboard/export';

export interface AnalysisHeroProps {
  url: string;
  status: SynthesisStatus;
  onUrlChange: (url: string) => void;
  onAnalyze: () => void;
  onReanalyze: () => void;
  onCancel?: () => void;
  error?: string;
  quota?: string;
  /** True when this video already has a completed prior analysis (current view is 'done', or a pre-flight check on the typed URL found one) -- drives the single Analyze/Re-analyze button'label and which handler it calls. */
  isRepeat?: boolean;
}

export function AnalysisHero({ url, status, onUrlChange, onAnalyze, onReanalyze, onCancel, error, quota, isRepeat = false }: AnalysisHeroProps) {
  const streaming = status === "streaming";
  const disabled = streaming || !url || url.trim().length === 0;

  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      showToast('URL copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Failed to copy URL');
    }
  };

  return (
    <ViewTransition enter="fade-in" exit="fade-out" default="none">
      <section className="relative transition-all duration-300 ease-out" aria-label="YouTube analysis hero">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <MonoLabel index="//">synthesis console</MonoLabel>
            {quota && <span className="font-mono text-[11px] text-[var(--ink-secondary)]">{quota}</span>}
          </div>
          <StatusBadge status={status} />
        </div>

        <AnimatePresence mode="wait">
          {status === 'idle' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="overflow-hidden mb-2"
            >
              <motion.h1
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.2, delay: 0.05 }}
                className="hx-h1 max-w-[20ch]"
              >
                Drop a YouTube URL. Get a structured synthesis across 11 dimensions.
              </motion.h1>
              <motion.p
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.2, delay: 0.1 }}
                className="hx-body-lg mt-1.5 max-w-[54ch]"
              >
                Transcript, claims, frameworks, and contrarian takes, mapped into your knowledge graph and searchable in seconds.
              </motion.p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-1.5 sm:mt-2">
          <CornerFrame tone={streaming ? "accent" : "line"}>
            <GlowBorder active={streaming} radius="control">
              <div className="flex items-center gap-2 sm:gap-3 bg-[var(--surface)] p-2 sm:p-2.5 rounded-lg shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)] w-full min-w-0">
                <span aria-hidden className={`grid place-items-center w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-[var(--bg)] ${streaming ? 'text-[var(--accent)]' : 'text-[var(--ink-muted)]'} flex-shrink-0 border border-[var(--line)]`}>
                  <Icon icon="solar:link-round-angle-linear" size={18} />
                </span>
                <div className="flex-1 min-w-0 flex items-center w-full">
                  <input
                    type="text"
                    aria-label="YouTube video URL"
                    value={url}
                    onChange={(e) => onUrlChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !disabled) {
                        if (isRepeat) onReanalyze(); else onAnalyze();
                      }
                    }}
                    placeholder="https://youtube.com/watch?v=..."
                    disabled={streaming}
                    aria-describedby={status === "error" ? "hero-error" : undefined}
                    className="w-full min-w-0 font-mono text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)] bg-transparent border-none outline-none shadow-none px-1 overflow-x-auto"
                  />
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {url && (
                    <div className="flex items-center gap-1">
                      <Tooltip content="Copy URL">
                        <button
                          type="button"
                          onClick={handleCopy}
                          className={`bg-transparent border-none ${copied ? 'text-[var(--accent)]' : 'text-[var(--ink-muted)]'} cursor-pointer p-1.5 flex items-center justify-center rounded-md hover:bg-[var(--surface-raised)] hover:text-[var(--ink)] active:scale-95 transition-all duration-[var(--dur-fast)]`}
                        >
                          <Icon icon={copied ? "solar:check-read-linear" : "solar:copy-linear"} size={16} />
                        </button>
                      </Tooltip>
                      <Tooltip content="Clear input">
                        <button
                          type="button"
                          onClick={() => onUrlChange('')}
                          className="bg-transparent border-none text-[var(--ink-muted)] cursor-pointer p-1.5 flex items-center justify-center rounded-md hover:bg-[var(--surface-raised)] hover:text-[var(--ink)] active:scale-95 transition-all duration-[var(--dur-fast)]"
                        >
                          <Icon icon="solar:close-circle-linear" size={16} />
                        </button>
                      </Tooltip>
                    </div>
                  )}
                  {streaming && onCancel && (
                    <Button
                      type="button"
                      label="Cancel analysis"
                      variant="destructive"
                      size="md"
                      isIconOnly
                      icon={<Icon icon="solar:stop-circle-linear" size={16} />}
                      onClick={onCancel}
                    />
                  )}
                  <Button
                    type="button"
                    label={streaming ? "Analyzing" : isRepeat ? "Re-analyze" : "Analyze"}
                    variant={isRepeat ? "secondary" : "primary"}
                    size="md"
                    tooltip={isRepeat ? "Re-analyze this video (runs fresh, not from cache)" : "Analyze YouTube video and extract multi-dimensional intelligence"}
                    onClick={isRepeat ? onReanalyze : onAnalyze}
                    isDisabled={disabled}
                    isLoading={streaming}
                    icon={!streaming ? <Icon icon="solar:bolt-linear" size={16} /> : undefined}
                  />
                </div>
              </div>
            </GlowBorder>
          </CornerFrame>
        </div>

        <div className={`mt-1 flex items-center text-xs ${status === "error" && error ? "min-h-5" : ""}`}>
          <span id="hero-error" role="alert" aria-live="assertive" className="font-mono text-[var(--err)] font-medium">{status === "error" ? error : ""}</span>
        </div>
      </section>
    </ViewTransition>
  );
}
