'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/templates/_shared/primitives';

interface SavedSearch {
  id: string;
  analysisId: string;
  title: string;
  channelTitle?: string;
  snippet: string;
  savedAt: string;
  viewCount?: number;
}

/**
 * /app/analyses/saved/page.tsx
 *
 * Saved searches listing page
 *
 * Features:
 * - List all saved search results
 * - Delete saved searches
 * - Quick view analysis
 * - Sort by date saved
 * - Filter/search within saved items
 */
export default function SavedSearchesPage() {
  const router = useRouter();

  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Load saved searches on mount
  useEffect(() => {
    loadSavedSearches();
  }, []);

  const loadSavedSearches = async () => {
    try {
      setIsLoading(true);
      setError(null);
      // Mock data for now
      setSavedSearches([]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load saved searches';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteSearch = async (id: string) => {
    if (!confirm('Are you sure you want to remove this saved search?')) {
      return;
    }
    setSavedSearches((prev) => prev.filter((item) => item.id !== id));
  };

  const handleViewAnalysis = (analysisId: string) => {
    router.push(`/analyses/${analysisId}`);
  };

  const filteredSearches = savedSearches.filter((search) =>
    search.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    search.channelTitle?.toLowerCase().includes(searchQuery.toLowerCase())
  );


  return (
    <div className="min-h-screen bg-void text-ink font-sans">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="hx-h1 mb-2">
            Saved Searches
          </h1>
          <p className="hx-body-secondary">
            Quick access to your saved analysis results
          </p>
        </div>

        {/* Search Filter */}
        <div className="mb-6 hx-rise">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter saved searches..."
            className="w-full px-4 py-3 bg-surface border border-line rounded-lg focus:outline-none focus:border-accent text-ink transition-all"
          />
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-err/10 border border-err/20 rounded-lg flex items-start gap-3">
            <Icon icon="solar:danger-circle-linear" size={20} className="text-err flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-err">Error</p>
              <p className="text-sm text-err/80">{error}</p>
            </div>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="h-24 bg-surface rounded-lg border border-line" />
              </div>
            ))}
          </div>
        )}

        {/* Content */}
        {!isLoading && (
          <>
            {/* Empty State */}
            {savedSearches.length === 0 && (
              <div className="text-center py-16 hx-rise">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-surface border border-line rounded-full mb-4">
                  <Icon icon="solar:heart-linear" size={32} className="text-ink-muted" />
                </div>
                <h3 className="text-xl font-semibold text-ink mb-2">
                  No Saved Searches Yet
                </h3>
                <p className="text-ink-muted mb-6">
                  Save search results from your analysis page to access them quickly
                </p>
                <button
                  onClick={() => router.push('/search')}
                  className="px-6 py-2 bg-accent text-void rounded-lg hover:bg-accent-strong transition-colors font-bold uppercase tracking-wider text-sm"
                >
                  Go to Search
                </button>
              </div>
            )}

            {/* Saved Searches List */}
            {filteredSearches.length > 0 && (
              <div className="space-y-4 hx-rise">
                <div className="text-caption font-mono text-ink-muted uppercase tracking-widest mb-4">
                  {filteredSearches.length} saved item{filteredSearches.length !== 1 ? 's' : ''}
                </div>

                {filteredSearches.map((search) => (
                  <div
                    key={search.id}
                    className="p-5 bg-surface border border-line rounded-xl hover:border-accent/20 transition-all group"
                  >
                    {/* Header: Title + Badge */}
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-ink text-lg line-clamp-2 hover:text-accent cursor-pointer transition-colors">
                          {search.title}
                        </h3>
                      </div>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-err/10 text-err border border-err/20 rounded text-[10px] font-bold uppercase tracking-wider flex-shrink-0">
                        <Icon icon="solar:heart-linear" size={12} style={{ fill: 'currentColor' }} />
                        Saved
                      </span>
                    </div>

                    {/* Snippet */}
                    <p className="text-sm text-ink-secondary line-clamp-2 mb-4 leading-relaxed">
                      {search.snippet}
                    </p>

                    {/* Metadata */}
                    <div className="flex flex-wrap gap-2 mb-4 text-caption font-mono text-ink-muted">
                      {search.channelTitle && (
                        <span className="inline-block px-2 py-1 bg-void border border-line rounded">
                          {search.channelTitle}
                        </span>
                      )}
                      {search.viewCount !== undefined && (
                        <span className="inline-block px-2 py-1 bg-void border border-line rounded">
                          {formatNumber(search.viewCount)} views
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-void border border-line rounded">
                        <Icon icon="solar:clock-circle-linear" size={12} />
                        {new Date(search.savedAt).toLocaleDateString()}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-4 border-t border-line/50">
                      <button
                        onClick={() => handleViewAnalysis(search.analysisId)}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-accent text-void rounded-lg hover:bg-accent-strong transition-all text-xs font-bold uppercase tracking-widest"
                      >
                        <Icon icon="solar:external-link-linear" size={14} />
                        View Analysis
                      </button>
                      <button
                        onClick={() => handleDeleteSearch(search.id)}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-void text-ink-muted border border-line rounded-lg hover:bg-err/10 hover:text-err hover:border-err/20 transition-all"
                        title="Remove from saved"
                      >
                        <Icon icon="solar:trash-bin-trash-linear" size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* No Results After Filter */}
            {savedSearches.length > 0 && filteredSearches.length === 0 && (
              <div className="text-center py-8">
                <p className="text-ink-muted">No saved searches match your filter</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1) + 'M';
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1) + 'K';
  }
  return num.toString();
}
