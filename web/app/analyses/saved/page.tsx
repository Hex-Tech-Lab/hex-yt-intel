'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  AlertCircle,
  Heart,
  Trash2,
  ExternalLink,
  Clock,
} from 'lucide-react';

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
 *
 * TODO: Implement persistence to database
 */
export default function SavedSearchesPage() {
  const { status } = useSession();
  const router = useRouter();

  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Redirect to signin if not authenticated
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
    }
  }, [status, router]);

  // Load saved searches from database
  useEffect(() => {
    if (status === 'authenticated') {
      loadSavedSearches();
    }
  }, [status]);

  const loadSavedSearches = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // TODO: Replace with actual API call
      // const response = await fetch('/api/analyses/saved');
      // if (!response.ok) throw new Error('Failed to load saved searches');
      // const data = await response.json();
      // setSavedSearches(data.savedSearches || []);

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

    try {
      // TODO: API call to delete
      // await fetch(`/api/analyses/saved/${id}`, { method: 'DELETE' });
      setSavedSearches((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      alert('Failed to delete saved search');
    }
  };

  const handleViewAnalysis = (analysisId: string) => {
    router.push(`/analyses/${analysisId}`);
  };

  // Filter saved searches by query
  const filteredSearches = savedSearches.filter((search) =>
    search.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    search.channelTitle?.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Saved Searches
          </h1>
          <p className="text-gray-600">
            Quick access to your saved analysis results
          </p>
        </div>

        {/* Search Filter */}
        <div className="mb-6">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter saved searches..."
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all"
          />
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertCircle size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-red-900">Error</p>
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="h-24 bg-gray-200 rounded-lg" />
              </div>
            ))}
          </div>
        )}

        {/* Content */}
        {!isLoading && (
          <>
            {/* Empty State */}
            {savedSearches.length === 0 && (
              <div className="text-center py-16">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
                  <Heart size={32} className="text-gray-400" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  No Saved Searches Yet
                </h3>
                <p className="text-gray-600 mb-6">
                  Save search results from your analysis page to access them quickly
                </p>
                <button
                  onClick={() => router.push('/search')}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                  Go to Search
                </button>
              </div>
            )}

            {/* Saved Searches List */}
            {filteredSearches.length > 0 && (
              <div className="space-y-4">
                <div className="text-sm text-gray-600 mb-4">
                  {filteredSearches.length} saved search{filteredSearches.length !== 1 ? 'es' : ''}
                </div>

                {filteredSearches.map((search) => (
                  <div
                    key={search.id}
                    className="p-4 bg-white border border-gray-200 rounded-lg hover:shadow-md transition-shadow"
                  >
                    {/* Header: Title + Badge */}
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900 line-clamp-2 hover:text-blue-600 cursor-pointer">
                          {search.title}
                        </h3>
                      </div>
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-50 text-red-700 rounded text-xs font-medium flex-shrink-0">
                        <Heart size={12} fill="currentColor" />
                        Saved
                      </span>
                    </div>

                    {/* Snippet */}
                    <p className="text-sm text-gray-600 line-clamp-2 mb-3">
                      {search.snippet}
                    </p>

                    {/* Metadata */}
                    <div className="flex flex-wrap gap-2 mb-3 text-xs text-gray-500">
                      {search.channelTitle && (
                        <span className="inline-block px-2 py-1 bg-gray-100 text-gray-700 rounded">
                          {search.channelTitle}
                        </span>
                      )}
                      {search.viewCount !== undefined && (
                        <span className="inline-block px-2 py-1 bg-gray-100 text-gray-700 rounded">
                          {formatNumber(search.viewCount)} views
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-700 rounded">
                        <Clock size={12} />
                        {new Date(search.savedAt).toLocaleDateString()}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                      <button
                        onClick={() => handleViewAnalysis(search.analysisId)}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium"
                      >
                        <ExternalLink size={14} />
                        View
                      </button>
                      <button
                        onClick={() => handleDeleteSearch(search.id)}
                        className="flex items-center justify-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-red-50 hover:text-red-700 transition-colors text-sm font-medium"
                        title="Remove from saved"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* No Results After Filter */}
            {savedSearches.length > 0 && filteredSearches.length === 0 && (
              <div className="text-center py-8">
                <p className="text-gray-500">No saved searches match your filter</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

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
