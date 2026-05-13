'use client';

import React from 'react';
import { TrendingUp, Eye, Calendar, Heart, Share2 } from 'lucide-react';
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
    if (similarity >= 0.85) return 'from-green-400 to-green-600';
    if (similarity >= 0.75) return 'from-blue-400 to-blue-600';
    if (similarity >= 0.65) return 'from-yellow-400 to-yellow-600';
    return 'from-orange-400 to-orange-600';
  };

  const getSimilarityLabel = (similarity: number): string => {
    if (similarity >= 0.85) return 'Excellent Match';
    if (similarity >= 0.75) return 'Strong Match';
    if (similarity >= 0.65) return 'Good Match';
    return 'Fair Match';
  };

  return (
    <div className="p-4 bg-white border border-gray-200 rounded-lg hover:shadow-lg transition-shadow">
      {/* Header: Title + Similarity Badge */}
      <div className="flex items-start justify-between gap-4 mb-3">
        <button
          onClick={() => onViewClick?.(result.id)}
          className="flex-1 text-left hover:text-blue-600 transition-colors"
        >
          <h3 className="font-semibold text-gray-900 line-clamp-2 hover:underline">
            {result.title}
          </h3>
        </button>

        {/* Similarity Score Badge */}
        <div className={`relative w-16 h-16 rounded-full bg-gradient-to-br ${getSimilarityColor(result.similarity)} flex items-center justify-center flex-shrink-0 shadow-md`}>
          <div className="text-center">
            <div className="text-lg font-bold text-white">
              {(result.similarity * 100).toFixed(0)}%
            </div>
            <div className="text-xs text-white/80">
              {getSimilarityLabel(result.similarity).split(' ')[0]}
            </div>
          </div>
        </div>
      </div>

      {/* Snippet */}
      <p className="text-sm text-gray-600 line-clamp-3 mb-3">
        {result.snippet}
      </p>

      {/* Metadata Row */}
      <div className="flex flex-wrap gap-2 mb-3 text-xs text-gray-500">
        {/* Match Type Badge */}
        <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded font-medium">
          {result.matchType === 'semantic' ? (
            <>
              <TrendingUp size={12} />
              Semantic
            </>
          ) : (
            <>
              <Eye size={12} />
              Keyword
            </>
          )}
        </span>

        {/* Channel (if available) */}
        {result.channelTitle && (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-700 rounded font-medium">
            {result.channelTitle}
          </span>
        )}

        {/* View Count (if available) */}
        {result.viewCount !== undefined && result.viewCount > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-700 rounded font-medium">
            <Eye size={12} />
            {formatNumber(result.viewCount)} views
          </span>
        )}

        {/* Date */}
        <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-700 rounded font-medium">
          <Calendar size={12} />
          {formattedDate}
        </span>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
        {/* Save Button */}
        <button
          onClick={() => onSaveClick?.(result.id)}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            isSaved
              ? 'bg-red-50 text-red-700 hover:bg-red-100'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
          title={isSaved ? 'Remove from saved' : 'Save search'}
        >
          <Heart size={14} fill={isSaved ? 'currentColor' : 'none'} />
          {isSaved ? 'Saved' : 'Save'}
        </button>

        {/* Share Button */}
        <button
          onClick={() => onShareClick?.(result.id)}
          className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
          title="Copy shareable link"
        >
          <Share2 size={14} />
          Share
        </button>

        {/* View Button */}
        <button
          onClick={() => onViewClick?.(result.id)}
          className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-100 transition-colors"
          title="View full analysis"
        >
          <Eye size={14} />
          View
        </button>
      </div>
    </div>
  );
};

/**
 * Format large numbers (e.g., 1234567 -> 1.2M)
 */
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
