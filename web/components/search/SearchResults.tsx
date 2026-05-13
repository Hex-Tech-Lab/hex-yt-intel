'use client';

import React from 'react';
import { TrendingUp, Calendar, Eye } from 'lucide-react';

interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  similarity: number;
  createdAt: string;
  matchType: 'semantic' | 'keyword';
}

interface SearchResultsProps {
  results: SearchResult[];
  isLoading?: boolean;
  onResultClick?: (resultId: string) => void;
}

const SearchResults: React.FC<SearchResultsProps> = ({
  results,
  isLoading = false,
  onResultClick,
}) => {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
            <div className="h-3 bg-gray-100 rounded w-full mb-2" />
            <div className="h-3 bg-gray-100 rounded w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">No results found</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {results.map((result) => (
        <div
          key={result.id}
          onClick={() => onResultClick?.(result.id)}
          className="p-4 bg-white border border-gray-200 rounded-lg hover:shadow-md transition-shadow cursor-pointer"
        >
          {/* Header: Title + Similarity Badge */}
          <div className="flex items-start justify-between gap-4 mb-3">
            <h3 className="font-semibold text-gray-900 flex-1 line-clamp-2">
              {result.title}
            </h3>
            <div className="flex-shrink-0">
              {/* Similarity Score Circle */}
              <div className="relative w-14 h-14 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-white">
                  {(result.similarity * 100).toFixed(0)}%
                </span>
                {/* Radial Progress */}
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100">
                  <circle
                    cx="50"
                    cy="50"
                    r="45"
                    fill="none"
                    stroke="rgba(255,255,255,0.3)"
                    strokeWidth="2"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="45"
                    fill="none"
                    stroke="rgba(255,255,255,0.8)"
                    strokeWidth="2"
                    strokeDasharray={`${2 * Math.PI * 45 * result.similarity} ${2 * Math.PI * 45}`}
                    strokeLinecap="round"
                    transform="rotate(-90 50 50)"
                  />
                </svg>
              </div>
            </div>
          </div>

          {/* Snippet */}
          <p className="text-sm text-gray-600 line-clamp-3 mb-3">
            {result.snippet}
          </p>

          {/* Metadata: Match Type + Date */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium">
                {result.matchType === 'semantic' ? (
                  <>
                    <TrendingUp size={12} />
                    Semantic Match
                  </>
                ) : (
                  <>
                    <Eye size={12} />
                    Keyword Match
                  </>
                )}
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <Calendar size={12} />
              <time dateTime={result.createdAt}>
                {new Date(result.createdAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </time>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default SearchResults;
