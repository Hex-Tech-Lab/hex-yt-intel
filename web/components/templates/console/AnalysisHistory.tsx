'use client';

import { useState, useMemo } from 'react';
import { useAnalysisHistory } from '@/hooks/useAnalysisHistory';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { Icon } from '@/components/templates/_shared/primitives';

type SortOrder = 'date-desc' | 'date-asc';
type FilterStatus = 'all' | 'completed' | 'processing' | 'incomplete';

export interface AnalysisHistoryProps {
  /** Called when user selects an analysis from the history list; parent should switch to console view. */
  onSelectAnalysis?: () => void;
}

export function AnalysisHistory({ onSelectAnalysis }: AnalysisHistoryProps) {
  const { items, isLoading, error } = useAnalysisHistory();
  const { initializeAnalysis } = useSynthesisNucleus();
  const [sortBy, setSortBy] = useState<SortOrder>('date-desc');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [currentPage, setCurrentPage] = useState(0);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const ITEMS_PER_PAGE = 10;

  const restoreAnalysis = async (analysisId: string) => {
    setLoadingId(analysisId);
    try {
      const token = localStorage.getItem('auth_token') || '';
      const res = await fetch(`/api/analyses/${analysisId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) {
        console.error('Failed to restore analysis:', res.status);
        return;
      }
      const data = await res.json();
      initializeAnalysis({
        id: data.id,
        videoId: data.videoId,
        title: data.title,
        channelTitle: data.channelTitle,
        model: data.model,
        dimensions: {},
        validation: data.validation_report,
        streaming: data.streaming,
      });
      onSelectAnalysis?.();
    } catch (err) {
      console.error('Error restoring analysis:', err);
    } finally {
      setLoadingId(null);
    }
  };

  // Filter and sort the items
  const filteredAndSorted = useMemo(() => {
    let result = [...items];

    // Apply status filter
    if (filterStatus !== 'all') {
      result = result.filter(item => item.status === filterStatus);
    }

    // Apply sort
    result.sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return sortBy === 'date-desc' ? bTime - aTime : aTime - bTime;
    });

    return result;
  }, [items, filterStatus, sortBy]);

  // Calculate pagination
  const totalPages = Math.ceil(filteredAndSorted.length / ITEMS_PER_PAGE);
  const paginatedItems = filteredAndSorted.slice(
    currentPage * ITEMS_PER_PAGE,
    (currentPage + 1) * ITEMS_PER_PAGE
  );

  // Reset to first page when filters change
  if (currentPage > 0 && currentPage >= totalPages && totalPages > 0) {
    setCurrentPage(0);
  }

  if (isLoading) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-secondary)' }}>
        <Icon icon="solar:refresh-linear" size={24} style={{ animation: 'spin 2s linear infinite', display: 'inline-block', marginBottom: 16 }} />
        <p>Loading your analysis history...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-secondary)' }}>
        <Icon icon="solar:close-circle-linear" size={24} style={{ marginBottom: 16, color: 'var(--error)' }} />
        <p>{error}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-secondary)' }}>
        <Icon icon="solar:folder-open-linear" size={24} style={{ marginBottom: 16, opacity: 0.5 }} />
        <p>No analyses yet. Start by analyzing a YouTube video above.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 80 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>
            Analysis History ({filteredAndSorted.length})
          </h2>
        </div>

        {/* Controls: Sort + Filter */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          {/* Sort Dropdown */}
          <select
            value={sortBy}
            onChange={e => { setSortBy(e.target.value as SortOrder); setCurrentPage(0); }}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid var(--line)',
              background: 'var(--surface)',
              color: 'var(--ink)',
              fontSize: 13,
              cursor: 'pointer',
              transition: 'border var(--dur-fast)',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}
          >
            <option value="date-desc">Newest First</option>
            <option value="date-asc">Oldest First</option>
          </select>

          {/* Filter Dropdown */}
          <select
            value={filterStatus}
            onChange={e => { setFilterStatus(e.target.value as FilterStatus); setCurrentPage(0); }}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid var(--line)',
              background: 'var(--surface)',
              color: 'var(--ink)',
              fontSize: 13,
              cursor: 'pointer',
              transition: 'border var(--dur-fast)',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}
          >
            <option value="all">All Status</option>
            <option value="completed">Completed</option>
            <option value="processing">Processing</option>
            <option value="incomplete">Incomplete</option>
          </select>
        </div>

        {/* List */}
        {filteredAndSorted.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-secondary)', borderRadius: 8, border: '1px solid var(--line)' }}>
            <p>No analyses match the selected filter.</p>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {paginatedItems.map((item, idx) => (
                <div
                  key={item.id}
                  onClick={() => restoreAnalysis(item.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    borderRadius: 8,
                    border: '1px solid var(--line)',
                    background: 'var(--surface)',
                    cursor: loadingId === item.id ? 'wait' : 'pointer',
                    opacity: loadingId === item.id ? 0.6 : 1,
                    transition: 'all var(--dur-base)',
                    animation: `slideInDown 0.3s ease-out forwards`,
                    animationDelay: `${idx * 40}ms`,
                  }}
                  onMouseEnter={e => {
                    if (loadingId !== item.id) {
                      const elem = e.currentTarget;
                      elem.style.borderColor = 'var(--accent)';
                      elem.style.background = 'rgb(6 182 212 / 0.05)';
                    }
                  }}
                  onMouseLeave={e => {
                    const elem = e.currentTarget;
                    elem.style.borderColor = 'var(--line)';
                    elem.style.background = 'var(--surface)';
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: 'var(--ink)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      marginBottom: 4
                    }}>
                      {item.title}
                    </p>
                    <p style={{ fontSize: 12, color: 'var(--ink-secondary)' }}>
                      {new Date(item.createdAt).toLocaleDateString()} at {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginLeft: 16,
                    flexShrink: 0
                  }}>
                    {item.status === 'completed' && (
                      <>
                        <Icon icon="solar:check-circle-linear" size={16} style={{ color: 'var(--success)' }} />
                        <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 500 }}>Done</span>
                      </>
                    )}
                    {item.status === 'processing' && (
                      <>
                        <Icon icon="solar:clock-linear" size={16} style={{ color: 'var(--warning)' }} />
                        <span style={{ fontSize: 12, color: 'var(--warning)', fontWeight: 500 }}>Processing</span>
                      </>
                    )}
                    {item.status === 'incomplete' && (
                      <>
                        <Icon icon="solar-alert-circle-linear" size={16} style={{ color: 'var(--ink-secondary)' }} />
                        <span style={{ fontSize: 12, color: 'var(--ink-secondary)' }}>Incomplete</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
                <button
                  onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                  disabled={currentPage === 0}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: '1px solid var(--line)',
                    background: currentPage === 0 ? 'rgba(107, 114, 128, 0.1)' : 'var(--surface)',
                    color: currentPage === 0 ? 'var(--ink-secondary)' : 'var(--ink)',
                    fontSize: 13,
                    cursor: currentPage === 0 ? 'not-allowed' : 'pointer',
                    opacity: currentPage === 0 ? 0.5 : 1,
                    transition: 'all var(--dur-fast)',
                  }}
                >
                  ← Prev
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {Array.from({ length: totalPages }).map((_, page) => (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 4,
                        border: currentPage === page ? 'none' : '1px solid var(--line)',
                        background: currentPage === page ? 'var(--accent)' : 'var(--surface)',
                        color: currentPage === page ? 'white' : 'var(--ink)',
                        fontSize: 12,
                        fontWeight: currentPage === page ? 600 : 500,
                        cursor: 'pointer',
                        transition: 'all var(--dur-fast)',
                      }}
                    >
                      {page + 1}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={currentPage >= totalPages - 1}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: '1px solid var(--line)',
                    background: currentPage >= totalPages - 1 ? 'rgba(107, 114, 128, 0.1)' : 'var(--surface)',
                    color: currentPage >= totalPages - 1 ? 'var(--ink-secondary)' : 'var(--ink)',
                    fontSize: 13,
                    cursor: currentPage >= totalPages - 1 ? 'not-allowed' : 'pointer',
                    opacity: currentPage >= totalPages - 1 ? 0.5 : 1,
                    transition: 'all var(--dur-fast)',
                  }}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
