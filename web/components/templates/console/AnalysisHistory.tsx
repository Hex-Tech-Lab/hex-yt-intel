'use client';

import { useState, useMemo, useEffect } from 'react';
import { useAnalysisHistory } from '@/hooks/useAnalysisHistory';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { Icon } from '@/components/templates/_shared/primitives';
import { parseToUCISDimensions } from '@/lib/utils/ucis-parser';

type SortOrder = 'date-desc' | 'date-asc';
type FilterStatus = 'all' | 'completed' | 'processing' | 'incomplete';

export interface AnalysisHistoryProps {
  /** Called when user selects an analysis from the history list; parent should switch to console view. */
  onSelectAnalysis?: () => void;
}

export function AnalysisHistory({ onSelectAnalysis }: AnalysisHistoryProps) {
  const { items, isLoading, error } = useAnalysisHistory();
  const { initializeAnalysis, setIsLoading, setStatus, setVideoMetadata } = useAnalysisStore();
  const { initializeAnalysis: initSynthesis } = useSynthesisNucleus();
  const [sortBy, setSortBy] = useState<SortOrder>('date-desc');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [currentPage, setCurrentPage] = useState(0);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const ITEMS_PER_PAGE = 10;

  const restoreAnalysis = async (analysisId: string) => {
    setLoadingId(analysisId);
    setRestoreError(null);
    setIsLoading(true);
    try {
      const res = await fetch(`/api/analyses/${analysisId}`);
      if (!res.ok) {
        throw new Error(`Restoration failed (HTTP ${res.status})`);
      }
      const data = await res.json();
      
      const dimensions = parseToUCISDimensions(data.analysis_markdown || '');
      
      // Update Global Store (for header/metadata/button)
      initializeAnalysis(data.id, data.title, data.analysis_markdown);
      setVideoMetadata({
        id: data.videoId,
        title: data.title,
        channelTitle: data.channelTitle || 'Unknown',
        publishedAt: data.analysisAt || data.created_at || new Date().toISOString(),
        duration: data.duration || 0,
        viewCount: data.viewCount || 0,
        likeCount: data.likeCount || 0,
      } as any);

      // Update Nucleus Store (for grid/graph/relations)
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

      setStatus('complete');
      onSelectAnalysis?.();
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

    if (filterStatus !== 'all') {
      result = result.filter(item => item.status === filterStatus);
    }

    result.sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return sortBy === 'date-desc' ? bTime - aTime : aTime - bTime;
    });

    return result;
  }, [items, filterStatus, sortBy]);

  const totalPages = Math.ceil(filteredAndSorted.length / ITEMS_PER_PAGE);
  const paginatedItems = filteredAndSorted.slice(
    currentPage * ITEMS_PER_PAGE,
    (currentPage + 1) * ITEMS_PER_PAGE
  );

  useEffect(() => {
    if (currentPage > 0 && currentPage >= totalPages && totalPages > 0) {
      setCurrentPage(0);
    }
  }, [currentPage, totalPages]);

  if (isLoading) {
    return (
      <div className="p-12 text-center text-[var(--ink-secondary)]">
        <Icon icon="solar:refresh-linear" size={24} className="hx-anispin inline-block mb-4" />
        <p>Loading your analysis history...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-12 text-center text-[var(--ink-secondary)]">
        <Icon icon="solar:close-circle-linear" size={24} className="mb-4 text-[var(--err)]" />
        <p>{error}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="p-12 text-center text-[var(--ink-secondary)]">
        <Icon icon="solar:folder-open-linear" size={24} className="mb-4 opacity-50" />
        <p>No analyses yet. Start by analyzing a YouTube video above.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-20">
      <div>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-[var(--ink)]">
            Analysis History ({filteredAndSorted.length})
          </h2>
        </div>

        {restoreError && (
          <div className="mb-4 p-3 rounded-lg border border-[var(--err)]/20 bg-[var(--err)]/5 text-[var(--err)] text-sm flex items-center gap-2">
            <Icon icon="solar:danger-circle-linear" size={16} />
            {restoreError}
          </div>
        )}

        <div className="flex gap-3 mb-4 flex-wrap">
          <select
            value={sortBy}
            onChange={e => { setSortBy(e.target.value as SortOrder); setCurrentPage(0); }}
            className="px-3 py-2 rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] text-[13px] cursor-pointer transition-colors hover:border-[var(--accent)] outline-none"
          >
            <option value="date-desc">Newest First</option>
            <option value="date-asc">Oldest First</option>
          </select>

          <select
            value={filterStatus}
            onChange={e => { setFilterStatus(e.target.value as FilterStatus); setCurrentPage(0); }}
            className="px-3 py-2 rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] text-[13px] cursor-pointer transition-colors hover:border-[var(--accent)] outline-none"
          >
            <option value="all">All Status</option>
            <option value="completed">Completed</option>
            <option value="processing">Processing</option>
            <option value="incomplete">Incomplete</option>
          </select>
        </div>

        {filteredAndSorted.length === 0 ? (
          <div className="p-6 text-center text-[var(--ink-secondary)] rounded-lg border border-[var(--line)]">
            <p>No analyses match the selected filter.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2 mb-4">
              {paginatedItems.map((item, idx) => (
                <div
                  key={item.id}
                  onClick={() => restoreAnalysis(item.id)}
                  className={`flex items-center justify-between p-3 px-4 rounded-lg border border-[var(--line)] bg-[var(--surface)] transition-all hx-rise ${
                    loadingId === item.id ? 'cursor-wait opacity-60' : 'cursor-pointer hover:border-[var(--accent)] hover:bg-[var(--accent)]/5'
                  }`}
                  style={{ animationDelay: `${idx * 40}ms` }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-[var(--ink-muted)]">
                        {new Date(item.createdAt).toLocaleDateString()}
                      </span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                        item.status === 'completed' ? 'bg-[var(--ok)]/10 text-[var(--ok)]' :
                        item.status === 'processing' ? 'bg-[var(--accent)]/10 text-[var(--accent)]' :
                        'bg-[var(--ink-muted)]/10 text-[var(--ink-muted)]'
                      }`}>
                        {item.status}
                      </span>
                    </div>
                    <h3 className="text-sm font-medium text-[var(--ink)] truncate group-hover:text-[var(--accent)]">
                      {item.title || 'Untitled Analysis'}
                    </h3>
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    <Icon 
                      icon={loadingId === item.id ? "solar:refresh-linear" : "solar:alt-arrow-right-linear"} 
                      size={16} 
                      className={loadingId === item.id ? "hx-anispin text-[var(--accent)]" : "text-[var(--ink-muted)]"} 
                    />
                  </div>
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-6">
                <button
                  disabled={currentPage === 0}
                  onClick={() => setCurrentPage(p => p - 1)}
                  className="px-4 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-secondary)] text-xs font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:border-[var(--ink-muted)] transition-colors"
                >
                  Previous
                </button>
                <span className="text-xs font-mono text-[var(--ink-muted)]">
                  Page {currentPage + 1} of {totalPages}
                </span>
                <button
                  disabled={currentPage === totalPages - 1}
                  onClick={() => setCurrentPage(p => p + 1)}
                  className="px-4 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-secondary)] text-xs font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:border-[var(--ink-muted)] transition-colors"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
