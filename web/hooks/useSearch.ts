'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

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

interface RawSearchResult {
  analysisId?: string;
  id?: string;
  title?: string;
  excerpt?: string;
  snippet?: string;
  score?: number;
  similarity?: number;
  createdAt?: string;
  matchType?: 'semantic' | 'keyword';
  channelTitle?: string;
  viewCount?: number;
}

interface SearchApiResponse {
  results: RawSearchResult[];
  count?: number;
}

interface SearchState {
  results: SearchResult[];
  isLoading: boolean;
  error: string | null;
  totalResults: number;
}

const INITIAL_STATE: SearchState = {
  results: [],
  isLoading: false,
  error: null,
  totalResults: 0,
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
   * Execute search query against the vector database.
   * Sends POST to /api/search with query and topK parameters.
   * Updates loading state, handles errors, and updates results on success.
   * Clears results if query is empty after trimming.
   */
  const performSearch = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim()) {
        setState((prev) => ({
          ...prev,
          results: [],
          totalResults: 0,
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
          let errorMsg = 'Search failed';
          try {
            const errorData = await response.json();
            errorMsg = errorData.error || errorMsg;
          } catch {
            // Response body is not JSON (e.g., gateway error page)
          }
          throw new Error(errorMsg);
        }

        const data: SearchApiResponse = await response.json();
        const normalizedResults = (data.results || [])
          .filter((result) => result.analysisId || result.id)
          .map((result) => ({
            id: (result.analysisId || result.id) as string,
            title: result.title || '',
            snippet: result.excerpt || result.snippet || '',
            similarity: result.score ?? result.similarity ?? 0,
            createdAt: result.createdAt || new Date().toISOString(),
            matchType: result.matchType || 'semantic',
            channelTitle: result.channelTitle,
            viewCount: result.viewCount,
          }));
        setState((prev) => ({
          ...prev,
          results: normalizedResults,
          totalResults: data.count || 0,
          isLoading: false,
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[useSearch]', { message, url: '/api/search' });
        Sentry.captureException(err, { contexts: { search: { query: searchQuery } } });
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
   * Debounced query effect handler.
   * Waits for user to stop typing (debounceMs delay) before executing search.
   * Clears results for empty queries; clears/cancels previous timers on unmount.
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
   * Clear search query and reset all results, errors, and loading state.
   * Resets state to INITIAL_STATE with empty results and cleared error.
   */
  const clearSearch = useCallback(() => {
    setQuery('');
    setState((prev) => ({
      ...prev,
      results: [],
      error: null,
      totalResults: 0,
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
    totalResults: state.totalResults,

    // Actions
    clearSearch,
    performSearch,
  };
}
