'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Search, Loader2, AlertCircle } from 'lucide-react';

interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  similarity: number;
  createdAt: string;
  matchType: 'semantic' | 'keyword';
}

interface SearchBoxProps {
  onSearch?: (results: SearchResult[]) => void;
  placeholder?: string;
  maxResults?: number;
  threshold?: number;
}

const SearchBox: React.FC<SearchBoxProps> = ({
  onSearch,
  placeholder = 'Search analyses semantically...',
  maxResults = 10,
  threshold = 0.75,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queryTime, setQueryTime] = useState(0);
  const [showResults, setShowResults] = useState(false);

  // Debounced search function
  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setShowResults(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/analyses/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: searchQuery,
          limit: maxResults,
          threshold,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Search failed');
      }

      const data = await response.json();
      setResults(data.results || []);
      setQueryTime(data.queryTime || 0);
      setShowResults(true);

      if (onSearch) {
        onSearch(data.results || []);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Search failed';
      setError(message);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, [maxResults, threshold, onSearch]);

  // Debounce search (500ms delay)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim().length > 2) {
        performSearch(query);
      } else if (query.length === 0) {
        setShowResults(false);
        setResults([]);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [query, performSearch]);

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setError(null);
    setShowResults(false);
  };

  return (
    <div className="w-full">
      {/* Search Input */}
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
          <Search size={18} />
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          aria-label="Search analyses"
        />

        {/* Clear Button */}
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="Clear search"
          >
            ✕
          </button>
        )}

        {/* Loading Spinner */}
        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <Loader2 size={18} className="animate-spin text-blue-500" />
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
          <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Results */}
      {showResults && (
        <div className="mt-4 space-y-3">
          {/* Results Header */}
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700">
              Found {results.length} result{results.length !== 1 ? 's' : ''}
              {queryTime > 0 && (
                <span className="text-gray-500 ml-2">
                  ({queryTime}ms)
                </span>
              )}
            </p>
          </div>

          {/* Results List */}
          {results.length > 0 ? (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {results.map((result) => (
                <div
                  key={result.id}
                  className="p-3 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors cursor-pointer"
                >
                  {/* Title + Similarity Score */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="font-medium text-gray-900 line-clamp-2">
                      {result.title}
                    </h3>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <div className="w-12 h-6 bg-gradient-to-r from-blue-400 to-blue-600 rounded relative overflow-hidden">
                        <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
                          {(result.similarity * 100).toFixed(0)}%
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Snippet */}
                  <p className="text-sm text-gray-600 line-clamp-2 mb-2">
                    {result.snippet}
                  </p>

                  {/* Match Type + Date */}
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span className="inline-block px-2 py-1 bg-blue-100 text-blue-700 rounded">
                      {result.matchType === 'semantic' ? '🎯 Semantic' : '🔤 Keyword'}
                    </span>
                    <span>{new Date(result.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 text-center text-gray-500">
              <p>No results found. Try adjusting your search query.</p>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!showResults && !query && (
        <div className="mt-4 p-4 bg-gray-50 rounded-lg text-center text-gray-500">
          <p className="text-sm">
            Start typing to search your analyses semantically
          </p>
        </div>
      )}
    </div>
  );
};

export default SearchBox;
