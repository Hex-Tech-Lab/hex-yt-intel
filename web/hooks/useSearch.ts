'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

export interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  similarity: number;
  createdAt: string;
  matchType: 'semantic' | 'keyword';
  channelTitle?: string;
  viewCount?: number;
}

export interface SearchFilters {
  dateFrom?: string;
  dateTo?: string;
  channels?: string[];
  minEngagement?: 'low' | 'medium' | 'high';
  tier?: 'free' | 'pro';
}

export interface UseSearchOptions {
  maxResults?: number;
  threshold?: number;
  debounceMs?: number;
}

interface SearchState {
  results: SearchResult[];
  isLoading: boolean;
  error: string | null;
  queryTime: number;
  totalResults: number;
  currentPage: number;
  hasNextPage: boolean;
}

const INITIAL_STATE: SearchState = {
  results: [],
  isLoading: false,
  error: null,
  queryTime: 0,
  totalResults: 0,
  currentPage: 1,
  hasNextPage: false,
};

/**
 * useSearch Hook
 *
 * Handles semantic search with debouncing and result management.
 * Integrates with /api/search endpoint for vector-based and keyword search.
 *
 * Features:
 * - Debounced search (500ms default)
 * - Error handling and loading state
 * - Clear search results and query
 * - Performance metrics (queryTime)
 *
 * @param options - Configuration for search behavior
 * @param options.maxResults - Maximum results per query (default: 10)
 * @param options.debounceMs - Debounce delay in milliseconds (default: 500)
 * @returns Hook providing query state, results, loading state, and actions
 *
 * @example
 * const { query, setQuery, results, isLoading, clearSearch } = useSearch({
 *   maxResults: 20,
 * });
 */
export function useSearch(options: UseSearchOptions = {}) {
  const {
    maxResults = 10,
    debounceMs = 500,
  } = options;

  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>(INITIAL_STATE);
  const debounceTimer = useRef<NodeJS.Timeout | undefined>(undefined);

  /**
   * Execute search query
   * Sends to /api/search with current query
   */
  const performSearch = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim()) {
        setState((prev) => ({
          ...prev,
          results: [],
          totalResults: 0,
          currentPage: 1,
          hasNextPage: false,
        }));
        return;
      }

      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        const response = await fetch('/api/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: searchQuery,
            topK: maxResults,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Search failed');
        }

        const data = await response.json();
        setState((prev) => ({
          ...prev,
          results: data.results || [],
          totalResults: data.count || 0,
          queryTime: 0,
          currentPage: 1,
          hasNextPage: false,
          isLoading: false,
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Search failed';
        setState((prev) => ({
          ...prev,
          error: message,
          results: [],
          isLoading: false,
        }));
      }
    },
    [maxResults]
  );

  /**
   * Debounced query handler
   * Waits for user to stop typing before searching
   */
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    if (!query.trim()) {
      setState((prev) => ({
        ...prev,
        results: [],
        totalResults: 0,
        currentPage: 1,
      }));
      return;
    }

    debounceTimer.current = setTimeout(() => {
      performSearch(query);
    }, debounceMs);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [query, debounceMs, performSearch]);

  /**
   * Clear search and results
   */
  const clearSearch = useCallback(() => {
    setQuery('');
    setState((prev) => ({
      ...prev,
      results: [],
      error: null,
      totalResults: 0,
      currentPage: 1,
      hasNextPage: false,
      isLoading: false,
    }));
  }, []);

  return {
    // Query state
    query,
    setQuery,

    // Results state
    results: state.results,
    isLoading: state.isLoading,
    error: state.error,
    queryTime: state.queryTime,
    totalResults: state.totalResults,

    // Actions
    clearSearch,
    performSearch,
  };
}
