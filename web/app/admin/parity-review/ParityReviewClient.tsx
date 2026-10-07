'use client';

import { useEffect, useMemo, useState } from 'react';
import { Banner, Spinner, Badge, Markdown } from '@astryxdesign/core';
import { Icon } from '@/components/templates/_shared/primitives';
import { preprocessMarkdown } from '@/lib/utils/format';

interface DimensionOutputPair {
  haiku_output?: string;
  gptoss_output?: string;
}

interface ParityVideo {
  video_id: string;
  title?: string;
  language?: string;
  domain?: string;
  dimensions: Record<string, DimensionOutputPair>;
}

interface ParityBatch {
  videos: ParityVideo[];
}

/** Dimension keys expected in the parity batch: digest + the 11 UCIS dimensions. */
const DIMENSION_KEYS: { key: string; label: string; icon: string }[] = [
  { key: 'digest', label: 'Executive Digest', icon: 'solar:document-text-linear' },
  { key: 'dimension_1', label: '1. Content Overview', icon: 'solar:file-text-linear' },
  { key: 'dimension_2', label: '2. Key Themes', icon: 'solar:hashtag-linear' },
  { key: 'dimension_3', label: '3. Audience Fit', icon: 'solar:users-group-rounded-linear' },
  { key: 'dimension_4', label: '4. Tone & Style', icon: 'solar:pallete-2-linear' },
  { key: 'dimension_5', label: '5. Claims & Evidence', icon: 'solar:shield-check-linear' },
  { key: 'dimension_6', label: '6. Structure & Pacing', icon: 'solar:widget-4-linear' },
  { key: 'dimension_7', label: '7. Entities', icon: 'solar:global-linear' },
  { key: 'dimension_8', label: '8. Sentiment', icon: 'solar:chart-2-linear' },
  { key: 'dimension_9', label: '9. Risks & Flags', icon: 'solar:danger-triangle-linear' },
  { key: 'dimension_10', label: '10. SEO Signals', icon: 'solar:magnifer-linear' },
  { key: 'dimension_11', label: '11. Action Items', icon: 'solar:checklist-minimalistic-linear' },
];

const readoutComponents = {
  heading: ({ level, children }: { level: 1 | 2 | 3 | 4 | 5 | 6; children: React.ReactNode }) => {
    const Tag = `h${level}` as const;
    return <Tag className="font-mono text-[13px] font-bold text-[var(--ink)] mt-4 mb-2">{children}</Tag>;
  },
  paragraph: ({ children }: { children: React.ReactNode }) => <p className="mb-3 leading-relaxed">{children}</p>,
  code: ({ code, language }: { code: string; language?: string }) => (
    <pre className="bg-[var(--surface)] border border-[var(--line-faint)] rounded-md p-3 font-mono text-[12px] leading-relaxed overflow-x-auto my-3">
      <code className={language ? `language-${language}` : undefined}>{code}</code>
    </pre>
  ),
  inlineCode: ({ children }: { children: string }) => (
    <code className="bg-[var(--surface)] px-1.5 py-0.5 rounded font-mono text-[12px] text-[var(--ink)]">{children}</code>
  ),
};

/**
 * Internal review page: pick a video from a real (or, until generated,
 * mocked) parity test batch, then read a Haiku-4.5 output and a
 * GPT-OSS-120B output side by side, dimension by dimension.
 *
 * The right-hand columns replicate DimensionDrawer.tsx's visual treatment
 * (header bar, border, scroll behavior, SelectedDimensionReadout's markdown
 * styling) exactly -- just doubled into two equal-width columns instead of
 * one flyout, per the task requirement to reuse the existing panel pattern
 * rather than invent new styling.
 */
export function ParityReviewClient() {
  const [batch, setBatch] = useState<ParityBatch | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [selectedDimensionKey, setSelectedDimensionKey] = useState<string>('digest');

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/admin/parity-review');
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
        const payload: { available: boolean; data?: ParityBatch } = await res.json();
        if (payload.available && payload.data) {
          setBatch(payload.data);
        } else {
          // Real fix (Cubic P0, 2026-08-18): no synthetic mock data
          // rendered as if it were real evidence -- an admin could
          // mistake MOCK_BATCH for a real model-parity result. Show an
          // explicit "no real data" state instead.
          setUnavailable(true);
        }
      } catch (err) {
        console.error('[ParityReviewClient] failed to load parity batch:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (batch && batch.videos.length > 0 && !selectedVideoId) {
      setSelectedVideoId(batch.videos[0]!.video_id);
    }
  }, [batch, selectedVideoId]);

  const selectedVideo = useMemo(
    () => batch?.videos.find((video) => video.video_id === selectedVideoId) ?? null,
    [batch, selectedVideoId]
  );

  const selectedPair = selectedVideo?.dimensions[selectedDimensionKey];

  if (error) {
    return (
      <div className="p-4">
        <Banner status="error" title={`Failed to load parity batch: ${error}`} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 flex items-center gap-2 text-xs font-mono text-[var(--ink-muted)]">
        <Spinner size="sm" />
        <span>Loading parity test batch…</span>
      </div>
    );
  }

  if (unavailable || !batch) {
    return (
      <div className="p-4">
        <Banner
          status="warning"
          title="No real parity batch data available"
        />
        <p className="mt-2 text-[11px] text-[var(--ink-muted)] max-w-[60ch]">
          The real Haiku-4.5-vs-GPT-OSS-120B batch hasn&apos;t been generated yet at
          <code className="mx-1 bg-[var(--surface)] px-1 py-0.5 rounded">docs/research/2026-08-18-parity-batch-results.json</code>.
          This page intentionally does not render placeholder/mock data as if it were a real result.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 font-mono text-xs">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line)]">
        <div>
          <h1 className="text-sm font-bold text-[var(--ink-main)]">Model Parity Review: Haiku 4.5 vs GPT-OSS-120B</h1>
          <p className="text-[10px] text-[var(--ink-muted)] mt-0.5">
            {batch.videos.length} video{batch.videos.length === 1 ? '' : 's'} in batch
          </p>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left: video list */}
        <div className="w-[280px] shrink-0 border-r border-[var(--line)] overflow-y-auto hx-custom-scrollbar">
          {batch.videos.map((video) => {
            const isSelected = video.video_id === selectedVideoId;
            return (
              <button
                key={video.video_id}
                onClick={() => setSelectedVideoId(video.video_id)}
                className={`w-full text-left px-3 py-2.5 border-b border-[var(--line-faint)] transition-colors ${
                  isSelected ? 'bg-[var(--surface)]' : 'hover:bg-[var(--surface)]/50'
                }`}
              >
                <div className="text-[12px] font-semibold text-[var(--ink)] line-clamp-2">
                  {video.title || video.video_id}
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  {video.language && <Badge variant="neutral" label={video.language} />}
                  {video.domain && <Badge variant="neutral" label={video.domain} />}
                </div>
              </button>
            );
          })}
        </div>

        {/* Right: dimension tabs + two comparison columns */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--line)] overflow-x-auto shrink-0">
            {DIMENSION_KEYS.map((dim) => {
              const active = dim.key === selectedDimensionKey;
              const hasData = Boolean(selectedVideo?.dimensions[dim.key]);
              return (
                <button
                  key={dim.key}
                  onClick={() => setSelectedDimensionKey(dim.key)}
                  disabled={!hasData}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] whitespace-nowrap shrink-0 transition-colors ${
                    active
                      ? 'bg-[var(--accent)] text-[var(--bg)] font-semibold'
                      : hasData
                        ? 'text-[var(--ink-secondary)] hover:text-[var(--ink)] hover:bg-[var(--surface)]'
                        : 'text-[var(--ink-muted)] opacity-40 cursor-not-allowed'
                  }`}
                >
                  <Icon icon={dim.icon} size={12} />
                  {dim.label}
                </button>
              );
            })}
          </div>

          {!selectedVideo ? (
            <div className="flex-1 grid place-items-center text-[var(--ink-muted)] text-[12px]">
              Select a video to compare outputs.
            </div>
          ) : (
            <div className="flex flex-1 min-h-0">
              <ComparisonColumn label="Haiku 4.5" content={selectedPair?.haiku_output} />
              <ComparisonColumn label="GPT-OSS-120B" content={selectedPair?.gptoss_output} borderLeft />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One comparison column. Header bar + scroll container replicate
 * DimensionDrawer.tsx's header/content treatment exactly; content styling
 * replicates SelectedDimensionReadout.tsx's markdown treatment exactly.
 */
function ComparisonColumn({ label, content, borderLeft }: { label: string; content?: string; borderLeft?: boolean }) {
  return (
    <div className={`flex-1 min-w-0 flex flex-col ${borderLeft ? 'border-l border-[var(--line)]' : ''}`}>
      <div className="flex items-center px-3 py-2 border-b border-[var(--line)] bg-[rgb(17_20_29_/_0.6)] shrink-0">
        <span className="font-mono text-[12px] font-semibold uppercase tracking-wider text-[var(--ink)]">
          {label}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4 hx-custom-scrollbar">
        {content ? (
          <div className="text-[14px] leading-relaxed text-[var(--ink-secondary)]">
            <Markdown components={readoutComponents}>{preprocessMarkdown(content)}</Markdown>
          </div>
        ) : (
          <div className="text-[var(--ink-muted)] font-mono text-[12px] italic">
            No output available for this dimension.
          </div>
        )}
      </div>
    </div>
  );
}
