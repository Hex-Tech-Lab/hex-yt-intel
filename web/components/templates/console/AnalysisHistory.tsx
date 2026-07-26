'use client';

import { useState, useMemo, useEffect, startTransition, useRef, type ReactNode } from 'react';
import { Tooltip } from '@astryxdesign/core';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { useHistoryOverview } from '@/hooks/useHistoryOverview';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { useChatStore } from '@/store/useChatStore';
import { useInputStore } from '@/store/useInputStore';
import { Icon, StatusBadge } from '@/components/templates/_shared/primitives';
import { parseToUCISDimensions } from '@/lib/utils/ucis-parser';
import { useTotalDimensions } from '@/lib/config/synthesis-with-settings';
import { ExecutiveSummary, type ExecutiveSummaryData } from '@/components/organisms/ExecutiveSummary';
import type { HistoryOverviewItem } from '@/lib/ports';
import type { ClientPlatform } from '@/lib/utils/client-platform';

type SortOrder = 'recent' | 'oldest' | 'most-analyzed';
type FilterStatus = 'all' | HistoryOverviewItem['status'];

// UI micro-interaction timing, not a business-logic tunable -- keeps keystrokes
// from re-filtering on every character while still feeling instant (data is
// already client-resident, see search-box wiring below for why).
const SEARCH_DEBOUNCE_MS = 200;

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

// Device/platform chip config (RCA 2026-07-24: cross-account confusion had no
// "which device did I use" UI signal). Colors are OS-family-grouped CSS vars
// defined in globals.css -- Apple family shares blue, Android family shares
// green, Windows/Linux/web each get one distinct hue. Icons follow the same
// solar icon-set already used for MetricChip/Icon throughout this file.
const PLATFORM_STYLE: Record<ClientPlatform, { label: string; icon: string; varName: string }> = {
  ios: { label: 'iOS', icon: 'solar:iphone-linear', varName: '--platform-ios' },
  'ios-app': { label: 'iOS App', icon: 'solar:iphone-linear', varName: '--platform-ios-app' },
  macos: { label: 'macOS', icon: 'solar:laptop-linear', varName: '--platform-macos' },
  android: { label: 'Android', icon: 'solar:smartphone-linear', varName: '--platform-android' },
  'android-app': { label: 'Android App', icon: 'solar:smartphone-linear', varName: '--platform-android-app' },
  windows: { label: 'Windows', icon: 'solar:monitor-linear', varName: '--platform-windows' },
  linux: { label: 'Linux', icon: 'solar:monitor-linear', varName: '--platform-linux' },
  web: { label: 'Web', icon: 'solar:global-linear', varName: '--platform-web' },
};

/** Device-source chip. Omits itself (rather than an error state) for null/unrecognized platforms — older rows predate this column. */
function PlatformChip({ platform }: { platform: ClientPlatform | null }) {
  if (!platform || !PLATFORM_STYLE[platform]) return null;
  const { label, icon, varName } = PLATFORM_STYLE[platform];
  return (
    <span
      title={`Analyzed from ${label}`}
      className="shrink-0 inline-flex items-center gap-1 text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ color: `var(${varName})`, backgroundColor: `color-mix(in srgb, var(${varName}) 14%, transparent)` }}
    >
      <Icon icon={icon} size={11} />
      {label}
    </span>
  );
}

function MetricChip({ icon, children, title }: { icon: string; children: ReactNode; title: string }) {
  return (
    <Tooltip content={title}>
      <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--ink-secondary)]">
        <Icon icon={icon} size={12} className="text-[var(--ink-muted)]" />
        {children}
      </span>
    </Tooltip>
  );
}

/**
 * At-a-glance completeness map: one numbered cell per dimension (1..N).
 * Generated dimensions read green; missing ones read as dashed hollow cells,
 * so a partial analysis is legible without opening it. (A future "thin /
 * insufficient-data" amber tier needs a per-dimension substantive signal from
 * the history-overview function — tracked separately.)
 */
function DimensionDots({ present, totalDimensions, auxChips }: { present: number[]; totalDimensions: number; auxChips?: ReactNode }) {
  const presentSet = new Set(present);
  return (
    <div className="flex items-center gap-1.5 flex-wrap mt-3 pt-3 border-t border-[var(--line-faint)]">
      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--ink-muted)] mr-1">Dimensions</span>
      {Array.from({ length: totalDimensions }, (_, i) => i + 1).map((n) => {
        const isPresent = presentSet.has(n);
        return (
          <Tooltip key={n} content={`Dimension ${n}: ${isPresent ? 'generated' : 'missing'}`}>
            <span
              className={`inline-grid place-items-center w-5 h-5 rounded text-[9px] font-mono font-semibold tabular-nums ${
                isPresent
                  ? 'bg-[var(--ok)]/15 text-[var(--ok)] border border-[var(--ok)]/40'
                  : 'bg-transparent text-[var(--ink-muted)] border border-dashed border-[var(--line)]'
              }`}
            >
              {n}
            </span>
          </Tooltip>
        );
      })}
      {auxChips}
    </div>
  );
}

/**
 * Vercel-style shimmer skeleton row, shape-matched to the real history-item
 * card below (title row + metrics row + dimension-dots row) so the layout
 * doesn't jump when data arrives. `index` staggers Astryx's built-in pulse
 * timing per row for the wave effect the user asked for ("especially with
 * any lists"), same as Vercel's own deployments-list loading state.
 */
function HistoryRowSkeleton({ index }: { index: number }) {
  return (
    <div className="rounded-xl border border-[var(--line)] p-4 bg-[var(--card)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 flex items-center gap-2">
          <Skeleton width={20} height={20} radius="rounded" index={index} />
          <Skeleton width="45%" height={16} index={index} />
        </div>
        <Skeleton width={64} height={16} radius={1} index={index} />
      </div>
      <div className="flex items-center gap-4 mt-3">
        <Skeleton width={90} height={12} index={index} />
        <Skeleton width={70} height={12} index={index} />
        <Skeleton width={110} height={12} index={index} />
      </div>
      <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-[var(--line-faint)]">
        <Skeleton width={64} height={10} index={index} />
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} width={20} height={20} radius={2} index={index} />
        ))}
      </div>
    </div>
  );
}

function extractExecutiveSummary(digest?: Record<string, any> | null): ExecutiveSummaryData | null {
  // Digest is the 4-tier structure: snapshot, overview, keyTakeaways, detailedSummary.
  // Full 11-dimension markdown is never a valid fallback source for this — it isn't
  // the same content, and parsing it as if it were produced the malformed-markdown
  // "summary" bug reported live (raw ##/** showing in the WIP card).
  if (digest && typeof digest === 'object' && ('snapshot' in digest || 'overview' in digest)) {
    return {
      snapshot: (digest.snapshot ?? ''),
      keyTakeaways: Array.isArray(digest.takeaways) ? digest.takeaways : [],
      overview: (digest.overview ?? ''),
      detailedSummary: (digest.detailedSummary ?? ''),
    };
  }

  return null;
}

export function AnalysisHistory({ onSelectAnalysis }: AnalysisHistoryProps) {
  const TOTAL_DIMENSIONS = useTotalDimensions();
  const { items, isLoading, error, refetch: refetchHistoryOverview } = useHistoryOverview();
  const { analysis: currentAnalysis, status: currentStatus, videoMetadata: currentVideoMetadata } = useAnalysisStore();

  // Refetch once per completion, not on every render while status stays
  // 'complete' -- tracks the analysis id so a second re-analysis of the same
  // video triggers a second refetch instead of only firing once ever.
  const refetchedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentStatus !== 'complete' || !currentAnalysis?.id) return;
    if (refetchedForRef.current === currentAnalysis.id) return;
    refetchedForRef.current = currentAnalysis.id;
    void refetchHistoryOverview();
  }, [currentStatus, currentAnalysis?.id, refetchHistoryOverview]);
  const { initializeAnalysis, setIsLoading, setStatus, setVideoMetadata } = useAnalysisStore();
  const { initializeAnalysis: initSynthesis } = useSynthesisNucleus();
  const { url } = useInputStore();
  const [sortBy, setSortBy] = useState<SortOrder>('recent');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [currentPage, setCurrentPage] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Search-as-you-type: narrows from the first keystroke (no minimum length),
  // debounced ~200ms so rapid typing doesn't re-filter on every character.
  // Client-side over `items` (already fully loaded by useHistoryOverview) --
  // get_user_history_overview() has no LIMIT and returns every one of the
  // user's analyses in one call already, so a server round-trip here would
  // just re-fetch data the client already holds. See report for the fuller
  // scale justification against a Redis/pg_trgm-indexed endpoint.
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const debounceTimer = setTimeout(() => setDebouncedSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(debounceTimer);
  }, [searchInput]);

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

    const query = debouncedSearch.trim().toLowerCase();
    if (query) {
      result = result.filter(
        (item) =>
          item.title?.toLowerCase().includes(query) ||
          item.channelTitle?.toLowerCase().includes(query)
      );
    }

    result.sort((a, b) => {
      if (sortBy === 'most-analyzed') return b.timesAnalyzed - a.timesAnalyzed;
      const aTime = new Date(a.lastAnalyzedAt).getTime();
      const bTime = new Date(b.lastAnalyzedAt).getTime();
      return sortBy === 'oldest' ? aTime - bTime : bTime - aTime;
    });
    return result;
  }, [items, filterStatus, sortBy, debouncedSearch]);

  const totalPages = Math.ceil(filteredAndSorted.length / ITEMS_PER_PAGE);
  const paginatedItems = filteredAndSorted.slice(currentPage * ITEMS_PER_PAGE, (currentPage + 1) * ITEMS_PER_PAGE);

  useEffect(() => {
    if (currentPage > 0 && currentPage >= totalPages && totalPages > 0) setCurrentPage(0);
  }, [currentPage, totalPages]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 pb-20">
        <Skeleton width={220} height={22} index={0} />
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 6 }, (_, i) => (
            <HistoryRowSkeleton key={i} index={i} />
          ))}
        </div>
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
        <div className="flex-1 min-w-[200px]">
          {/* Astryx pilot (2026-07-24): first component from the new design
              system, per user's explicit ask to rebuild recent UI work on it.
              startIcon/hasClear/isLabelHidden replace what was previously
              hand-rolled with an absolutely-positioned Icon + raw <input>.

              Astryx rollout (2026-07-25): investigated swapping this for
              PowerSearch (`@astryxdesign/core/PowerSearch`). Kept TextInput --
              PowerSearch is a structured token-filter bar: it requires a
              PowerSearchConfig of fields/operators and renders filters as
              removable chips (field + operator + value), even its
              `contentSearchFieldKey` free-text mode still needs a full field
              config and produces PowerSearchFilter[] output. This box is a
              single plain substring match over title/channel feeding the
              existing `filteredAndSorted` useMemo via a plain string --
              adopting PowerSearch would mean inventing a fake one-field config
              just to get a token UI this search doesn't need, and reshaping
              the debounced-string filter into filter-array handling for no
              behavioral gain. TextInput's startIcon/hasClear/isLabelHidden
              already cover the real UX need. */}
          <TextInput
            label="Search analysis history by title or channel"
            isLabelHidden
            value={searchInput}
            onChange={(value) => { setSearchInput(value); setCurrentPage(0); }}
            placeholder="Search by title or channel…"
            startIcon={<Icon icon="solar:magnifer-linear" size={14} />}
            hasClear
          />
        </div>

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
                <ExecutiveSummary data={extractExecutiveSummary(currentAnalysis?.executiveDigest)} />
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
                  className={`rounded-xl border border-[var(--line)] p-4 transition-all hx-rise focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                    idx % 2 === 1 ? 'bg-[var(--card-quiet)]' : 'bg-[var(--card)]'
                  } ${
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
                          <Tooltip content="Partial analysis: incomplete data from timeout">
                            <span className="flex-shrink-0 w-2.5 h-2.5 rounded-full bg-[var(--warn)] animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
                          </Tooltip>
                        )}
                      </div>
                      {item.channelTitle && (
                        <p className="text-[12px] text-[var(--ink-muted)] truncate mt-0.5">{item.channelTitle}</p>
                      )}
                    </div>
                    <PlatformChip platform={item.clientPlatform} />
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

                  {/* Per-dimension completeness map (green = generated, hollow = missing), aux-status
                      chips (Wave A4) appended to the SAME wrapping row right after dim. 11 -- one
                      flex-wrap container so chips spill to a new line on narrow viewports instead of
                      a fixed second row that could clip. */}
                  {item.status !== 'processing' && (item.presentDimensions.length > 0 || item.missingDimensions.length > 0) && (
                    <DimensionDots
                      present={item.presentDimensions}
                      totalDimensions={TOTAL_DIMENSIONS}
                      auxChips={
                        (item.status === 'complete' || item.status === 'partial') && (
                          <span className="flex flex-wrap gap-1.5 ml-1" role="status" aria-label="Auxiliary data status">
                            <StatusBadge status={item.hasDigest ? 'done' : 'idle'} label="DIGEST" />
                            <StatusBadge status={item.hasDescription ? 'done' : 'idle'} label="DESCRIPTION" />
                            <StatusBadge status={item.hasChannelMeta ? 'done' : 'idle'} label="CHANNEL META" />
                            <StatusBadge status={item.hasComments ? 'done' : 'idle'} label="COMMENTS" />
                          </span>
                        )
                      }
                    />
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
