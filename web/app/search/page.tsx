'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/templates/_shared/primitives';
import { useSearch } from '@/hooks/useSearch';
import ResultCard from '@/components/search/result-card';

function showToast(message: string, type: 'success' | 'error' = 'success') {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.textContent = message;
  el.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 18px;border-radius:10px;font:600 12px/1.4 var(--font-mono);pointer-events:none;opacity:0;transition:opacity .2s;color:var(--ink);background:${type === 'error' ? 'rgba(239,68,68,0.9)' : 'rgba(6,182,212,0.9)'};backdrop-filter:blur(8px);`;
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2000);
}

/**
 * /app/search/page.tsx
 *
 * Main search page component
 *
 * Features:
 * - Semantic search input with debouncing
 * - Results grid display
 * - Performance metrics
 */
export default function SearchPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const {
    query,
    setQuery,
    results,
    isLoading,
    error,
    queryTime,
    totalResults,
    clearSearch,
  } = useSearch({
    maxResults: 20,
    debounceMs: 500,
  });

  const [savedSearches, setSavedSearches] = useState<Set<string>>(new Set());

  // Seed the query from a `?q=` param on mount (e.g. arriving from the console
  // TopBar search box). Read from location directly to avoid a useSearchParams
  // Suspense boundary; the debounced search effect then runs automatically.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q');
    if (q) setQuery(q);
  }, [setQuery]);

  // Redirect to signin if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/auth/signin');
    }
  }, [isAuthenticated, authLoading, router]);

  const handleSaveSearch = async (resultId: string) => {
    const newSaved = new Set(savedSearches);
    if (newSaved.has(resultId)) {
      newSaved.delete(resultId);
    } else {
      newSaved.add(resultId);
    }
    setSavedSearches(newSaved);
  };

  const handleShareSearch = async (resultId: string) => {
    const url = `${window.location.origin}/analyses/${resultId}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied to clipboard!');
    } catch {
      showToast('Failed to copy link', 'error');
    }
  };

  const handleViewAnalysis = (resultId: string) => {
    router.push(`/analyses/${resultId}`);
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Icon icon="solar:refresh-linear" size={40} className="hx-anispin text-accent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // Will redirect
  }

  return (
    <div className="min-h-screen bg-void text-ink">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-accent hover:text-accent-strong transition-colors mb-4 font-medium text-sm"
          >
            <Icon icon="solar:alt-arrow-left-linear" size={18} />
            Back
          </button>
          <h1 className="hx-h1 mb-2">
            Search Your Analyses
          </h1>
          <p className="hx-body-secondary">
            Find insights across your YouTube content intelligence reports
          </p>
        </div>

        {/* Search Input */}
        <div className="mb-6">
          <div className="relative hx-rise">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted">
              <Icon icon="solar:magnifer-linear" size={20} />
            </div>

            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search semantically... (e.g., 'video production tips', 'marketing trends')"
              className="w-full pl-12 pr-12 py-4 bg-surface border-2 border-line rounded-lg focus:outline-none focus:border-accent transition-all text-ink"
              autoFocus
            />

            {/* Loading State */}
            {isLoading && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                <Icon icon="solar:refresh-linear" size={20} className="hx-anispin text-accent" />
              </div>
            )}

            {/* Clear Button */}
            {query && !isLoading && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink transition-colors"
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-err/10 border border-err/20 rounded-lg flex items-start gap-3">
            <Icon icon="solar:danger-circle-linear" size={20} className="text-err flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-err">Search Error</p>
              <p className="text-sm text-err/80">{error}</p>
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <div className="grid grid-cols-1 gap-6">
          {/* Results Section */}
          <div>
            {/* Results Header */}
            {query && (
              <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold text-ink">
                    Results
                  </h2>
                  <span className="text-sm text-ink-muted">
                    {totalResults} found
                    {queryTime > 0 && (
                      <span className="ml-2 text-ink-muted/60">
                        ({queryTime}ms)
                      </span>
                    )}
                  </span>
                </div>
              </div>
            )}

            {/* Empty State */}
            {!query && !isLoading && (
              <div className="text-center py-16 hx-rise">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-surface border border-line rounded-full mb-4">
                  <Icon icon="solar:magnifer-linear" size={32} className="text-accent" />
                </div>
                <h3 className="text-xl font-semibold text-ink mb-2">
                  Start Searching
                </h3>
                <p className="text-ink-muted">
                  Enter a search query to find insights across your analyses
                </p>
              </div>
            )}

            {/* No Results */}
            {query &&
              !isLoading &&
              results.length === 0 &&
              !error && (
                <div className="text-center py-16 hx-rise">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-surface border border-line rounded-full mb-4">
                    <Icon icon="solar:magnifer-linear" size={32} className="text-ink-muted" />
                  </div>
                  <h3 className="text-xl font-semibold text-ink mb-2">
                    No Results Found
                  </h3>
                  <p className="text-ink-muted mb-4">
                    Try adjusting your search query
                  </p>
                  <button
                    onClick={clearSearch}
                    className="text-accent hover:text-accent-ink font-medium"
                  >
                    Clear search
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

            {/* Loading State */}
            {isLoading && (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="animate-pulse">
                    <div className="h-32 bg-surface rounded-lg border border-line" />
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
