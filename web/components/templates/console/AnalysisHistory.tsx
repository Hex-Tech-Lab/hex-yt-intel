'use client';

import { useState, useMemo, useEffect, startTransition, useRef, type ReactNode } from 'react';
import { useHistoryOverview } from '@/hooks/useHistoryOverview';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { useChatStore } from '@/store/useChatStore';
import { useInputStore } from '@/store/useInputStore';
import { Icon } from '@/components/templates/_shared/primitives';
import { parseToUCISDimensions } from '@/lib/utils/ucis-parser';
import { useTotalDimensions } from '@/lib/config/synthesis-with-settings';
import { ExecutiveSummary, type ExecutiveSummaryData } from '@/components/organisms/ExecutiveSummary';
import type { HistoryOverviewItem } from '@/lib/ports';

type SortOrder = 'recent' | 'oldest' | 'most-analyzed';
type FilterStatus = 'all' | HistoryOverviewItem['status'];

export interface AnalysisHistoryProps {
  /** Called when user selects an analysis; parent should switch to console view. */
  onSelectAnalysis?: () => void;
}

const STATUS_STYLE: Record<HistoryOverviewItem['status'], { label: string; cls: string }> = {
  complete: { label: 'Complete', cls: 'bg-[var(--ok)]/10 text-[var(--ok)]' },
  partial: { label: 'Partial', cls: 'bg-[var(--accent)]/12 text-[var(--accent-ink)]' },
  processing: { label: 'Processing', cls: 'bg-[var(--accent)]/10 text-[var(--accent)]' },
  failed: { label: 'Failed', cls: 'bg-[var(--ink-muted)]/10 text-[var(--ink-muted)]' },
};

function MetricChip({ icon, children, title }: { icon: string; children: ReactNode; title: string }) {
  return (
    <span title={title} className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--ink-secondary)]">
      <Icon icon={icon} size={12} className="text-[var(--ink-muted)]" />
      {children}
    </span>
  );
}

/**
 * At-a-glance completeness map: one numbered cell per dimension (1..N).
 * Generated dimensions read green; missing ones read as dashed hollow cells,
 * so a partial analysis is legible without opening it. (A future "thin /
 * insufficient-data" amber tier needs a per-dimension substantive signal from
 * the history-overview function — tracked separately.)
 */
function DimensionDots({ present, totalDimensions }: { present: number[]; totalDimensions: number }) {
  const presentSet = new Set(present);
  return (
    <div className="flex items-center gap-1 flex-wrap mt-3 pt-3 border-t border-[var(--line-faint)]">
      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--ink-muted)] mr-1">Dimensions</span>
      {Array.from({ length: totalDimensions }, (_, i) => i + 1).map((n) => {
        const isPresent = presentSet.has(n);
        return (
          <span
            key={n}
            title={`Dimension ${n}: ${isPresent ? 'generated' : 'missing'}`}
            className={`inline-grid place-items-center w-5 h-5 rounded text-[9px] font-mono font-semibold tabular-nums ${
              isPresent
                ? 'bg-[var(--ok)]/15 text-[var(--ok)] border border-[var(--ok)]/40'
                : 'bg-transparent text-[var(--ink-muted)] border border-dashed border-[var(--line)]'
            }`}
          >
            {n}
          </span>
        );
      })}
    </div>
  );
}

function extractExecutiveSummary(markdown: string | undefined, digest?: Record<string, any> | null): ExecutiveSummaryData | null {
  // Prefer stored digest (3-tier structure)
  if (digest && typeof digest === 'object' && ('snapshot' in digest || 'overview' in digest)) {
    return {
      snapshot: (digest.snapshot ?? ''),
      keyTakeaways: Array.isArray(digest.takeaways) ? digest.takeaways : [],
      overview: (digest.overview ?? ''),
    };
  }

  // Fallback: if no digest, don't try to parse full markdown
  // (it contains all 11 dimensions, not just the 3-tier digest)
  return null;
}

export function AnalysisHistory({ onSelectAnalysis }: AnalysisHistoryProps) {
  const TOTAL_DIMENSIONS = useTotalDimensions();
  const { items, isLoading, error } = useHistoryOverview();
  const { analysis: currentAnalysis, status: currentStatus, videoMetadata: currentVideoMetadata } = useAnalysisStore();
  const { initializeAnalysis, setIsLoading, setStatus, setVideoMetadata } = useAnalysisStore();
  const { initializeAnalysis: initSynthesis } = useSynthesisNucleus();
  const { url } = useInputStore();
  const [sortBy, setSortBy] = useState<SortOrder>('recent');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [currentPage, setCurrentPage] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [currentPage]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const ITEMS_PER_PAGE = 10;

  // Determine if actively analyzing (as opposed to complete analysis in window)
  const isActivelyAnalyzing = currentStatus === 'analyzing' || currentStatus === 'downloading' || currentStatus === 'parsing';

  // Show WIP section when: URL exists in box AND analysis exists AND has data AND (actively analyzing OR analysis complete)
  // Check for executiveDigest for zero-dimensional analyses
  const hasAnalysisData = Boolean(currentAnalysis?.analysis_markdown || currentAnalysis?.executiveDigest);

  // Real dimension count for the analysis currently in the window
  const wipDimCount = useMemo(
    () => Object.keys(parseToUCISDimensions(currentAnalysis?.analysis_markdown)).length,
    [currentAnalysis?.analysis_markdown]
  );
  const showWIPSection = url && currentAnalysis && currentAnalysis.id && hasAnalysisData && (isActivelyAnalyzing || currentStatus === 'complete');

  // Debug: Log showWIPSection condition to diagnose rendering issues
  if (typeof window !== 'undefined' && window.__CHAT_DEBUG) {
    console.debug('[AnalysisHistory] WIP section condition', {
      hasUrl: !!url,
      hasCurrentAnalysis: !!currentAnalysis,
      hasAnalysisId: !!currentAnalysis?.id,
      isActivelyAnalyzing,
      isComplete: currentStatus === 'complete',
      showWIPSection,
      currentStatus,
      analysisTitle: currentAnalysis?.title,
      analysisHasMarkdown: !!currentAnalysis?.analysis_markdown,
    });
  }

  const restoreAnalysis = async (analysisId: string) => {
    setLoadingId(analysisId);
    setRestoreError(null);
    setIsLoading(true);
    try {
      const res = await fetch(`/api/analyses/${analysisId}`);
      if (!res.ok) throw new Error(`Restoration failed (HTTP ${res.status})`);
      const data = await res.json();

      const dimensions = parseToUCISDimensions(data.analysis_markdown || '');

      // Repopulate the URL input from the restored video so the Analyze /
      // re-analyze controls are enabled — both bail on an empty `url`, so
      // without this the box shows only its placeholder and both buttons no-op.
      if (data.videoId) {
        const restoredUrl = `https://www.youtube.com/watch?v=${data.videoId}`;
        useInputStore.getState().setUrl(restoredUrl);
        useInputStore.getState().validateUrl(restoredUrl);
      }

      startTransition(() => {
        initializeAnalysis(data.id, data.title, data.analysis_markdown, data.executiveDigest ?? null);
        setVideoMetadata({
          videoId: data.videoId,
          title: data.title,
          channelTitle: data.channelTitle || 'Unknown',
          publishedAt: data.analysisAt || data.created_at || new Date().toISOString(),
          duration: data.duration || 0,
          viewCount: data.viewCount || 0,
          likeCount: data.likeCount || 0,
        } as never);

        initSynthesis({
          id: data.id,
          videoId: data.videoId,
          title: data.title,
          channelTitle: data.channelTitle,
          model: data.model,
          analysisAt: data.analysisAt,
          detectedPersona: data.detectedPersona,
          dimensions,
          validation: data.validation_report,
          streaming: data.streaming,
        });

        if (data.analysis_payload) {
          const payload = data.analysis_payload;
          const state = useSynthesisNucleus.getState();
          if (payload.persona) state.setPersonaConfig(payload.persona);
          if (payload.knowledgeGraph) state.setKnowledgeGraph(payload.knowledgeGraph);
          if (payload.classification) state.setClassification(payload.classification);
          if (payload.monetizationVerdict) state.setMonetizationVerdict(payload.monetizationVerdict);
        }

        if (data.analysisStatus === 'error') {
          setStatus('error');
          useAnalysisStore.getState().setError({
            code: 'ERR_ANALYSIS_FAILED',
            status: 500,
            message: 'This analysis failed to generate. Please try re-analyzing.',
          });
        } else if (data.analysisStatus !== 'complete') {
          setStatus(data.analysisStatus || 'error');
        } else {
          setStatus('complete');
        }
        onSelectAnalysis?.();
      });

      // Pre-ground the chat conversation for the restored analysis in the background
      void (async () => {
        try {
          const chatStore = useChatStore.getState();
          await chatStore.loadConversations();
          const existing = chatStore.conversations.find((c) => c.videoId === data.videoId);
          if (existing) {
            if (existing.analysisId !== data.id) {
              await chatStore.updateConversationAnalysisId(existing.id, data.id);
            }
            await chatStore.selectConversation(existing.id);
          } else {
            useChatStore.setState({ activeId: null });
          }
        } catch (e) {
          console.debug('[AnalysisHistory] Background chat session restoration failed:', e);
        }
      })();
    } catch (err) {
      console.error('Error restoring analysis:', err);
      setRestoreError(err instanceof Error ? err.message : 'Unknown restoration error');
      setStatus('error');
    } finally {
      setLoadingId(null);
      setIsLoading(false);
    }
  };

  const filteredAndSorted = useMemo(() => {
    let result = [...items];
    if (filterStatus !== 'all') result = result.filter((item) => item.status === filterStatus);

    result.sort((a, b) => {
      if (sortBy === 'most-analyzed') return b.timesAnalyzed - a.timesAnalyzed;
      const aTime = new Date(a.lastAnalyzedAt).getTime();
      const bTime = new Date(b.lastAnalyzedAt).getTime();
      return sortBy === 'oldest' ? aTime - bTime : bTime - aTime;
    });
    return result;
  }, [items, filterStatus, sortBy]);

  const totalPages = Math.ceil(filteredAndSorted.length / ITEMS_PER_PAGE);
  const paginatedItems = filteredAndSorted.slice(currentPage * ITEMS_PER_PAGE, (currentPage + 1) * ITEMS_PER_PAGE);

  useEffect(() => {
    if (currentPage > 0 && currentPage >= totalPages && totalPages > 0) setCurrentPage(0);
  }, [currentPage, totalPages]);

  if (isLoading) {
    return (
      <div className="p-4 text-center text-[var(--ink-secondary)]">
        <Icon icon="solar:refresh-linear" size={24} className="hx-anispin inline-block mb-4" />
        <p>Loading your analysis history…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center text-[var(--ink-secondary)]">
        <Icon icon="solar:close-circle-linear" size={24} className="mb-4 text-[var(--err)]" />
        <p>{error}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="p-4 text-center text-[var(--ink-secondary)]">
        <Icon icon="solar:folder-open-linear" size={24} className="mb-4 opacity-50" />
        <p>No analyses yet. Start by analyzing a YouTube video above.</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-4 pb-20">
      <h2 className="text-lg font-semibold text-[var(--ink)]">
        Analysis History <span className="text-[var(--ink-muted)] font-normal">({filteredAndSorted.length})</span>
      </h2>

      {restoreError && (
        <div className="p-3 rounded-lg border border-[var(--err)]/20 bg-[var(--err)]/5 text-[var(--err)] text-sm flex items-center gap-2">
          <Icon icon="solar:danger-circle-linear" size={16} />
          {restoreError}
        </div>
      )}

      <div className="flex gap-3 flex-wrap">
        <select
          value={sortBy}
          onChange={(e) => { setSortBy(e.target.value as SortOrder); setCurrentPage(0); }}
          className="px-3 py-2 rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] text-[13px] cursor-pointer transition-colors hover:border-[var(--accent)] outline-none"
        >
          <option value="recent">Recently analyzed</option>
          <option value="oldest">Oldest first</option>
          <option value="most-analyzed">Most analyzed</option>
        </select>

        <select
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value as FilterStatus); setCurrentPage(0); }}
          className="px-3 py-2 rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] text-[13px] cursor-pointer transition-colors hover:border-[var(--accent)] outline-none"
        >
          <option value="all">All status</option>
          <option value="complete">Complete</option>
          <option value="partial">Partial</option>
          <option value="processing">Processing</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Work-in-Progress Section — shows video in window that is either actively analyzing or has completed analysis */}
      {showWIPSection && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 mb-1">
            {isActivelyAnalyzing ? (
              <>
                <Icon icon="solar:refresh-linear" size={18} className="hx-anispin text-[var(--accent)]" />
                <h2 className="text-lg font-semibold text-[var(--ink)]">
                  Currently in Synthesis <span className="text-[var(--ink-muted)] font-normal">(1)</span>
                </h2>
                <span className="text-[10px] font-mono text-[var(--ink-muted)]">Analyzing in real-time</span>
              </>
            ) : (
              <>
                <Icon icon="solar:check-circle-linear" size={18} className="text-[var(--ok)]" />
                <h2 className="text-lg font-semibold text-[var(--ink)]">
                  Last Analyzed <span className="text-[var(--ink-muted)] font-normal">(1)</span>
                </h2>
                <span className="text-[10px] font-mono text-[var(--ink-muted)]">Analysis complete</span>
              </>
            )}
          </div>
          <div className={`rounded-xl border-2 p-4 ${isActivelyAnalyzing ? 'border-[var(--accent)] bg-[var(--accent)]/5' : 'border-[var(--ok)]/40 bg-[var(--ok)]/5'}`}>
            {/* Title row */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-[var(--ink)] truncate">{currentAnalysis?.title || 'Untitled Analysis'}</h3>
                  {isActivelyAnalyzing ? (
                    <span className="flex-shrink-0 inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider bg-[var(--accent)]/10 text-[var(--accent)]">
                      <Icon icon="solar:refresh-linear" size={12} className="hx-anispin" />
                      Analyzing
                    </span>
                  ) : (
                    <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider bg-[var(--ok)]/10 text-[var(--ok)]">
                      Complete
                    </span>
                  )}
                </div>
                {currentVideoMetadata?.channelTitle && (
                  <p className="text-[12px] text-[var(--ink-muted)] truncate mt-0.5">{currentVideoMetadata.channelTitle}</p>
                )}
              </div>
            </div>

            {/* Metrics row */}
            {isActivelyAnalyzing ? (
              <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap mt-3">
                <MetricChip icon="solar:layers-minimalistic-linear" title="Dimensions received so far">
                  <span className="text-[var(--ink)] font-semibold">{wipDimCount}</span>/{TOTAL_DIMENSIONS} dims
                </MetricChip>
                <span className="text-[11px] text-[var(--ink-muted)]">Streaming updates…</span>
                <Icon icon="solar:refresh-linear" size={16} className="hx-anispin text-[var(--accent)] ml-auto" />
              </div>
            ) : (
              <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap mt-3">
                <MetricChip icon="solar:layers-minimalistic-linear" title="Dimensions generated">
                  <span className="text-[var(--ink)] font-semibold">{wipDimCount}</span>/{TOTAL_DIMENSIONS} dims
                </MetricChip>
                <span className="text-[11px] text-[var(--ink-muted)]">Ready to view</span>
              </div>
            )}

            {/* Dimension 0: Executive Summary */}
            {currentStatus === 'complete' && hasAnalysisData && (
              <div className="mt-6 pt-6 border-t border-[var(--line-faint)]">
                <h3 className="text-sm font-semibold text-[var(--ink)] mb-3">Dimension 0 — Executive Summary</h3>
                <ExecutiveSummary data={extractExecutiveSummary(currentAnalysis?.analysis_markdown, currentAnalysis?.executiveDigest)} />
              </div>
            )}
          </div>
        </div>
      )}

      {filteredAndSorted.length === 0 ? (
        <div className="p-6 text-center text-[var(--ink-secondary)] rounded-lg border border-[var(--line)]">
          <p>No analyses match the selected filter.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2.5">
            {paginatedItems.map((item, idx) => {
              const busy = loadingId === item.analysisId;
              const status = STATUS_STYLE[item.status];
              const itemNumber = currentPage * ITEMS_PER_PAGE + idx + 1;
              return (
                <div
                  key={item.baseVideoId}
                  onClick={() => !busy && restoreAnalysis(item.analysisId)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); restoreAnalysis(item.analysisId); } }}
                  className={`rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 transition-all hx-rise focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                    busy ? 'cursor-wait opacity-60' : 'cursor-pointer hover:border-[var(--accent)] hover:bg-[var(--accent)]/5'
                  }`}
                  style={{ animationDelay: `${idx * 40}ms` }}
                >
                  {/* Title row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--ink-muted)]/15 text-[9px] font-bold tabular-nums text-[var(--ink-muted)]">
                          {itemNumber}
                        </span>
                        <h3 className="text-sm font-semibold text-[var(--ink)] truncate">{item.title || 'Untitled Analysis'}</h3>
                        {item.status === 'partial' && (
                          <span title="Partial analysis: incomplete data from timeout" className="flex-shrink-0 w-2.5 h-2.5 rounded-full bg-[var(--warn)] animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
                        )}
                      </div>
                      {item.channelTitle && (
                        <p className="text-[12px] text-[var(--ink-muted)] truncate mt-0.5">{item.channelTitle}</p>
                      )}
                    </div>
                    <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${status.cls}`}>
                      {status.label}
                    </span>
                  </div>

                  {/* Metrics row — wraps on narrow screens (no horizontal overflow) */}
                  <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap mt-3">
                    <MetricChip icon="solar:layers-minimalistic-linear" title="Dimensions produced">
                      <span className="text-[var(--ink)] font-semibold">{item.bestDimensions}</span>/{TOTAL_DIMENSIONS} dims
                    </MetricChip>
                    {item.status === 'partial' && (
                      <MetricChip icon="solar:alert-circle-linear" title="Partial analysis with incomplete data">
                        <span className="text-[var(--warn)]">Incomplete</span>
                      </MetricChip>
                    )}
                    {item.status === 'complete' && (
                      <MetricChip icon="solar:star-linear" title="Executive digest (Dimension 0)">
                        Dim.0
                      </MetricChip>
                    )}
                    <MetricChip icon="solar:refresh-linear" title="Times analyzed (including re-runs)">
                      {item.timesAnalyzed}× analyzed
                    </MetricChip>
                    <MetricChip icon="solar:eye-linear" title="Times opened">
                      {item.views} views
                    </MetricChip>
                    <MetricChip icon="solar:calendar-minimalistic-linear" title="Last analyzed">
                      {new Date(item.lastAnalyzedAt).toLocaleString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: true,
                      })}
                    </MetricChip>
                    <span className="ml-auto inline-flex items-center text-[var(--ink-muted)]">
                      <Icon icon={busy ? 'solar:refresh-linear' : 'solar:alt-arrow-right-linear'} size={16} className={busy ? 'hx-anispin text-[var(--accent)]' : ''} />
                    </span>
                  </div>

                  {/* Per-dimension completeness map (green = generated, hollow = missing) */}
                  {item.status !== 'processing' && (item.presentDimensions.length > 0 || item.missingDimensions.length > 0) && (
                    <DimensionDots present={item.presentDimensions} totalDimensions={TOTAL_DIMENSIONS} />
                  )}
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <button
                disabled={currentPage === 0}
                onClick={() => setCurrentPage((p) => p - 1)}
                className="px-4 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-secondary)] text-xs font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:border-[var(--ink-muted)] transition-colors"
              >
                Previous
              </button>
              <span className="text-xs font-mono text-[var(--ink-muted)]">Page {currentPage + 1} of {totalPages}</span>
              <button
                disabled={currentPage === totalPages - 1}
                onClick={() => setCurrentPage((p) => p + 1)}
                className="px-4 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-secondary)] text-xs font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:border-[var(--ink-muted)] transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
