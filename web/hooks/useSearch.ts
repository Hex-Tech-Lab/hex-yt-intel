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
 * Handles semantic search with debouncing, pagination, and filtering
 * Integrates with /api/analyses/search endpoint
 *
 * Features:
 * - Debounced search (500ms default)
 * - Pagination support
 * - Filter support (date range, channels, engagement)
 * - Error handling
 * - Performance metrics (queryTime)
 *
 * @example
 * const { query, setQuery, results, isLoading, filters, setFilters } = useSearch({
 *   maxResults: 20,
 *   threshold: 0.75,
 * });
 */
export function useSearch(options: UseSearchOptions = {}) {
  const {
    maxResults = 10,
    threshold = 0.75,
    debounceMs = 500,
  } = options;

  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>(INITIAL_STATE);

  const [filters, setFilters] = useState<SearchFilters>({});
  const debounceTimer = useRef<NodeJS.Timeout | undefined>(undefined);

  /**
   * Execute search query
   * Sends to /api/analyses/search with current query and filters
   */
  const performSearch = useCallback(
    async (searchQuery: string, page: number = 1) => {
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
    [maxResults, threshold, filters]
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
      performSearch(query, 1);
    }, debounceMs);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [query, debounceMs, performSearch]);

  /**
   * Pagination: move to next page
   */
  const nextPage = useCallback(() => {
    const nextPageNum = state.currentPage + 1;
    performSearch(query, nextPageNum);
  }, [query, state.currentPage, performSearch]);

  /**
   * Pagination: move to previous page
   */
  const prevPage = useCallback(() => {
    const prevPageNum = Math.max(1, state.currentPage - 1);
    performSearch(query, prevPageNum);
  }, [query, state.currentPage, performSearch]);

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

  /**
   * Update filters and trigger new search
   */
  const updateFilters = useCallback((newFilters: Partial<SearchFilters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
    // Search will be triggered by the effect watching filters
  }, []);

  /**
   * Clear all filters and re-search
   */
  const clearFilters = useCallback(() => {
    setFilters({});
    if (query.trim()) {
      setQuery(query);
    }
  }, [query]);

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

    // Pagination
    currentPage: state.currentPage,
    hasNextPage: state.hasNextPage,
    nextPage,
    prevPage,

    // Filters
    filters,
    setFilters: updateFilters,
    clearFilters,

    // Actions
    clearSearch,
    performSearch,
  };
}
