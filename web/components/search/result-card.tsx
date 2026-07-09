'use client';

import React from 'react';
import { Icon } from '@/components/templates/_shared/primitives';
import type { SearchResult } from '@/hooks/useSearch';

interface ResultCardProps {
  result: SearchResult;
  onSaveClick?: (resultId: string) => void;
  onShareClick?: (resultId: string) => void;
  onViewClick?: (resultId: string) => void;
  isSaved?: boolean;
}

/**
 * ResultCard Component
 *
 * Individual search result card with:
 * - Title and snippet
 * - Similarity score visualization
 * - Metadata (channel, views, date)
 * - Action buttons (save, share, view)
 */
const ResultCard: React.FC<ResultCardProps> = ({
  result,
  onSaveClick,
  onShareClick,
  onViewClick,
  isSaved = false,
}) => {
  const formattedDate = new Date(result.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const getSimilarityColor = (similarity: number): string => {
    if (similarity >= 0.85) return 'from-green-500 to-emerald-600';
    if (similarity >= 0.75) return 'from-cyan-500 to-blue-600';
    if (similarity >= 0.65) return 'from-amber-400 to-orange-500';
    return 'from-rose-400 to-red-600';
  };

  const getSimilarityLabel = (similarity: number): string => {
    if (similarity >= 0.85) return 'Excellent';
    if (similarity >= 0.75) return 'Strong';
    if (similarity >= 0.65) return 'Good';
    return 'Fair';
  };

  return (
    <div className="p-3 bg-surface border border-line rounded-xl hover:shadow-lg hover:border-accent/30 transition-all group">
      {/* Header: Title + Similarity Badge */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <button
          onClick={() => onViewClick?.(result.id)}
          className="flex-1 text-left"
        >
          <h3 className="font-semibold text-ink text-lg line-clamp-2 group-hover:text-accent transition-colors">
            {result.title}
          </h3>
        </button>

        {/* Similarity Score Badge */}
        <div className={`relative w-14 h-14 rounded-full bg-gradient-to-br ${getSimilarityColor(result.similarity)} flex items-center justify-center flex-shrink-0 shadow-lg shadow-black/20`}>
          <div className="text-center">
            <div className="text-sm font-black text-void leading-tight">
              {(result.similarity * 100).toFixed(0)}%
            </div>
            <div className="text-[9px] font-bold text-void/70 uppercase tracking-tighter">
              {getSimilarityLabel(result.similarity)}
            </div>
          </div>
        </div>
      </div>

      {/* Snippet */}
      <p className="text-sm text-ink-secondary line-clamp-3 mb-4 leading-relaxed">
        {result.snippet}
      </p>

      {/* Metadata Row */}
      <div className="flex flex-wrap gap-2 mb-4 text-[11px] font-mono">
        {/* Match Type Badge */}
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-accent/10 text-accent-ink border border-accent/20 rounded uppercase tracking-wider">
          <Icon icon={result.matchType === 'semantic' ? "solar:graph-up-linear" : "solar:magnifer-linear"} size={12} />
          {result.matchType}
        </span>

        {/* Channel (if available) */}
        {result.channelTitle && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-void text-ink-secondary border border-line rounded">
            <Icon icon="solar:user-linear" size={12} />
            {result.channelTitle}
          </span>
        )}

        {/* View Count (if available) */}
        {result.viewCount !== undefined && result.viewCount > 0 && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-void text-ink-secondary border border-line rounded">
            <Icon icon="solar:eye-linear" size={12} />
            {formatNumber(result.viewCount)}
          </span>
        )}

        {/* Date */}
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-void text-ink-secondary border border-line rounded">
          <Icon icon="solar:calendar-linear" size={12} />
          {formattedDate}
        </span>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-2 pt-4 border-t border-line/50">
        {/* Save Button */}
        <button
          onClick={() => onSaveClick?.(result.id)}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
            isSaved
              ? 'bg-err/10 text-err border border-err/20'
              : 'bg-void text-ink-muted border border-line hover:border-ink-muted hover:text-ink'
          }`}
        >
          <Icon icon="solar:heart-linear" size={14} style={{ fill: isSaved ? 'currentColor' : 'none' }} />
          {isSaved ? 'Saved' : 'Save'}
        </button>

        {/* Share Button */}
        <button
          onClick={() => onShareClick?.(result.id)}
          className="flex items-center gap-1.5 px-3.5 py-1.5 bg-void text-ink-muted border border-line rounded-lg text-xs font-bold uppercase tracking-wider hover:border-ink-muted hover:text-ink transition-all"
        >
          <Icon icon="solar:share-linear" size={14} />
          Share
        </button>

        {/* View Button */}
        <button
          onClick={() => onViewClick?.(result.id)}
          className="flex items-center gap-1.5 px-3.5 py-1.5 bg-accent text-void rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-accent-strong transition-all"
        >
          <Icon icon="solar:eye-linear" size={14} />
          View Analysis
        </button>
      </div>
    </div>
  );
};

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1) + 'M';
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1) + 'K';
  }
  return num.toString();
}

export default ResultCard;
