'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Search, Loader2, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useSearch } from '@/hooks/useSearch';
import SearchFilters from '@/components/search/filters';
import ResultCard from '@/components/search/result-card';

/**
 * /app/search/page.tsx
 *
 * Main search page component
 *
 * Features:
 * - Semantic search input with debouncing
 * - Advanced filters (date, channel, engagement)
 * - Results grid with pagination
 * - Save searches (saved searches UI)
 * - Performance metrics
 *
 * Integrates with Chunk 7 API (/api/analyses/search)
 */
export default function SearchPage() {
  const { status } = useSession();
  const router = useRouter();

  const {
    query,
    setQuery,
    results,
    isLoading,
    error,
    queryTime,
    totalResults,
    currentPage,
    hasNextPage,
    filters,
    setFilters,
    clearFilters,
    clearSearch,
    nextPage,
    prevPage,
  } = useSearch({
    maxResults: 20,
    threshold: 0.7,
    debounceMs: 500,
  });

  const [savedSearches, setSavedSearches] = useState<Set<string>>(new Set());
  const [allChannels, setAllChannels] = useState<string[]>([]);

  // Redirect to signin if not authenticated
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
    }
  }, [status, router]);

  // Load unique channels from results for filter dropdown
  useEffect(() => {
    const channels = new Set<string>();
    results.forEach((result) => {
      if (result.channelTitle) {
        channels.add(result.channelTitle);
      }
    });
    setAllChannels(Array.from(channels).sort());
  }, [results]);

  const handleSaveSearch = async (resultId: string) => {
    const newSaved = new Set(savedSearches);
    if (newSaved.has(resultId)) {
      newSaved.delete(resultId);
    } else {
      newSaved.add(resultId);
    }
    setSavedSearches(newSaved);

    // TODO: Persist saved searches to database
    // await fetch('/api/analyses/saved', {
    //   method: 'POST',
    //   body: JSON.stringify({ analysisId: resultId, isSaved: newSaved.has(resultId) }),
    // });
  };

  const handleShareSearch = async (resultId: string) => {
    const url = `${window.location.origin}/analyses/${resultId}`;
    try {
      await navigator.clipboard.writeText(url);
      alert('Link copied to clipboard!');
    } catch {
      alert('Failed to copy link');
    }
  };

  const handleViewAnalysis = (resultId: string) => {
    router.push(`/analyses/${resultId}`);
  };

  const handleClearAll = () => {
    clearFilters();
    clearSearch();
  };

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin text-blue-500" size={40} />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return null; // Will redirect
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Search Your Analyses
          </h1>
          <p className="text-gray-600">
            Find insights across your YouTube content intelligence reports
          </p>
        </div>

        {/* Search Input */}
        <div className="mb-6">
          <div className="relative">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
              <Search size={20} />
            </div>

            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search semantically... (e.g., 'video production tips', 'marketing trends')"
              className="w-full pl-12 pr-12 py-4 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all"
              autoFocus
            />

            {/* Loading State */}
            {isLoading && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                <Loader2 size={20} className="animate-spin text-blue-500" />
              </div>
            )}

            {/* Clear Button */}
            {query && !isLoading && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertCircle size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-red-900">Search Error</p>
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Filters Sidebar */}
          <div className="lg:col-span-1">
            <div className="sticky top-6">
              <SearchFilters
                filters={filters}
                onFilterChange={setFilters}
                onClear={handleClearAll}
                allChannels={allChannels}
              />
            </div>
          </div>

          {/* Results Section */}
          <div className="lg:col-span-3">
            {/* Results Header */}
            {query && (
              <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold text-gray-900">
                    Results
                  </h2>
                  <span className="text-sm text-gray-600">
                    {totalResults} found
                    {queryTime > 0 && (
                      <span className="ml-2 text-gray-500">
                        ({queryTime}ms)
                      </span>
                    )}
                  </span>
                </div>
              </div>
            )}

            {/* Empty State */}
            {!query && !isLoading && (
              <div className="text-center py-16">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
                  <Search size={32} className="text-blue-600" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  Start Searching
                </h3>
                <p className="text-gray-600">
                  Enter a search query to find insights across your analyses
                </p>
              </div>
            )}

            {/* No Results */}
            {query &&
              !isLoading &&
              results.length === 0 &&
              !error && (
                <div className="text-center py-16">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
                    <Search size={32} className="text-gray-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">
                    No Results Found
                  </h3>
                  <p className="text-gray-600 mb-4">
                    Try adjusting your search query or filters
                  </p>
                  <button
                    onClick={handleClearAll}
                    className="text-blue-600 hover:text-blue-700 font-medium"
                  >
                    Clear all filters
                  </button>
                </div>
              )}

            {/* Results Grid */}
            {results.length > 0 && (
              <div className="space-y-4">
                {results.map((result) => (
                  <ResultCard
                    key={result.id}
                    result={result}
                    onSaveClick={handleSaveSearch}
                    onShareClick={handleShareSearch}
                    onViewClick={handleViewAnalysis}
                    isSaved={savedSearches.has(result.id)}
                  />
                ))}
              </div>
            )}

            {/* Pagination Controls */}
            {results.length > 0 && (
              <div className="mt-8 flex items-center justify-between">
                <button
                  onClick={prevPage}
                  disabled={currentPage === 1}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={18} />
                  Previous
                </button>

                <div className="text-sm text-gray-600">
                  Page {currentPage}
                  {hasNextPage && ' (more results available)'}
                </div>

                <button
                  onClick={nextPage}
                  disabled={!hasNextPage}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                  <ChevronRight size={18} />
                </button>
              </div>
            )}

            {/* Loading State */}
            {isLoading && (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="animate-pulse">
                    <div className="h-32 bg-gray-200 rounded-lg" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
