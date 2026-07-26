'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useImperativeAlertDialog } from '@astryxdesign/core';
import { Footer } from '@/components/Footer';
import { Icon, MonoLabel } from '@/components/templates/_shared/primitives';

interface SavedSearch {
  id: string;
  analysisId: string;
  title: string;
  channelTitle?: string;
  snippet: string;
  savedAt: string;
  viewCount?: number;
}

export default function SavedSearchesPage() {
  const router = useRouter();
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const deleteConfirm = useImperativeAlertDialog();

  useEffect(() => {
    loadSavedSearches();
  }, []);

  const loadSavedSearches = async () => {
    try {
      setIsLoading(true);
      setError(null);
      // Mock data for now - keeping functionality as is but refining UI
      setSavedSearches([]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load saved searches';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteSearch = (id: string) => {
    deleteConfirm.show({
      title: 'Remove saved search?',
      description: 'This will remove the saved search from your library. This action cannot be undone.',
      actionLabel: 'Remove',
      onAction: () => {
        setSavedSearches((prev) => prev.filter((item) => item.id !== id));
        deleteConfirm.hide();
      },
    });
  };

  const handleViewAnalysis = (analysisId: string) => {
    router.push(`/analyses/${analysisId}`);
  };

  const filteredSearches = savedSearches.filter((search) =>
    search.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    search.channelTitle?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#0B0E14] text-[#E2E8F0] selection:bg-[#06B6D430] font-sans flex flex-col">
      {/* Brand Aesthetic Background */}
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_50%_-20%,#06B6D415,transparent_50%)] pointer-events-none" />
      
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#11141DCC] backdrop-blur-xl border-b border-[#1E293B]">
        <div className="max-w-[1200px] mx-auto h-16 px-8 flex items-center justify-between">
          <Link href="/?v=landing" className="flex items-center gap-3 group">
            <span className="flex items-center justify-center w-7 h-7 bg-[#0891B2] text-[#0B0E14] rounded-lg shadow-[0_4px_12px_rgba(6,182,212,0.4)] transition-transform group-hover:scale-105">
              <Icon icon="solar:graph-up-linear" size={18} />
            </span>
            <span className="font-mono text-[15px] font-bold tracking-[0.04em] text-[#E2E8F0]">
              HEX{"\u00b7"}YT{"\u00b7"}INTEL
            </span>
          </Link>
          <nav className="flex gap-4 items-center">
            <Link href="/pricing" className="btn-secondary" style={{ textDecoration: "none" }}>Pricing</Link>
            <Link href="/dashboard" className="btn-primary" style={{ textDecoration: "none" }}>
              <Icon icon="solar:bolt-linear" size={16} />
              Dashboard
            </Link>
          </nav>
        </div>
      </header>

      <main className="relative z-10 flex-1 max-w-[1280px] mx-auto px-12 pt-48 pb-32 w-full">
        <div className="max-w-[800px]">
          {/* Header Section */}
          <div className="mb-12 animate-hx-rise">
             <div className="flex items-center gap-2 mb-6">
                <Link href="/dashboard" className="text-[11px] font-mono uppercase tracking-widest text-[#64748B] hover:text-[#06B6D4] transition-colors">Dashboard</Link>
                <span className="text-[#334155] font-mono text-[10px]">/</span>
                <span className="text-[11px] font-mono uppercase tracking-widest text-[#06B6D4]">Library</span>
             </div>

             <MonoLabel index="//" className="mb-4">Internal Repository</MonoLabel>
             <h1 className="text-[48px] font-medium tracking-tight text-[#E2E8F0] leading-[1.05] mb-4">
                Saved Searches
             </h1>
             <p className="text-[#94A3B8] text-lg max-w-[54ch]">
                Quick access to your curated video intelligence and synthesis results.
             </p>
          </div>

          {/* Search Filter */}
          <div className="mb-10 animate-hx-rise" style={{ animationDelay: "100ms" }}>
            <div className="relative group">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#475569] group-focus-within:text-[#06B6D4] transition-colors">
                <Icon icon="solar:magnifer-linear" size={18} />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search your library..."
                className="w-full pl-12 pr-4 py-4 bg-[#1A1F2B66] border border-[#1E293B] rounded-xl focus:outline-none focus:border-[#06B6D440] focus:ring-1 focus:ring-[#06B6D440] text-[#E2E8F0] transition-all placeholder:text-[#475569] font-sans"
              />
            </div>
          </div>

          {/* Content Area */}
          <div className="animate-hx-rise" style={{ animationDelay: "200ms" }}>
            {isLoading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-32 bg-[#1A1F2B44] border border-[#1E293B] rounded-xl animate-pulse" />
                ))}
              </div>
            ) : error ? (
              <div className="p-6 bg-[#EF444408] border border-[#EF444420] rounded-xl flex items-start gap-4">
                <Icon icon="solar:danger-circle-linear" size={20} className="text-[#EF4444] mt-0.5" />
                <div>
                  <p className="font-semibold text-[#EF4444]">Data Retrieval Error</p>
                  <p className="text-[#EF4444CC] text-sm">{error}</p>
                </div>
              </div>
            ) : filteredSearches.length === 0 ? (
              <div className="text-center py-24 border border-dashed border-[#1E293B] rounded-2xl">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-[#1A1F2B] border border-[#1E293B] rounded-full mb-6 text-[#475569]">
                  <Icon icon="solar:folder-error-linear" size={32} />
                </div>
                <h3 className="text-xl font-medium text-[#E2E8F0] mb-2">No syntheses found</h3>
                <p className="text-[#64748B] mb-8 max-w-[32ch] mx-auto">
                  Save results from the synthesis console to populate your technical library.
                </p>
                <Link href="/dashboard" className="btn-primary" style={{ textDecoration: "none" }}>
                  Go to Console
                </Link>
              </div>
            ) : (
              <div className="grid gap-4">
                {filteredSearches.map((search) => (
                  <div
                    key={search.id}
                    className="p-6 bg-[#1A1F2B66] border border-[#1E293B] rounded-2xl hover:border-[#06B6D440] transition-all group relative overflow-hidden"
                  >
                    <div className="relative z-10">
                      <div className="flex items-start justify-between gap-4 mb-4">
                        <div className="flex-1 min-w-0">
                          <h3 
                            onClick={() => handleViewAnalysis(search.analysisId)}
                            className="text-lg font-medium text-[#E2E8F0] hover:text-[#06B6D4] cursor-pointer transition-colors line-clamp-1"
                          >
                            {search.title}
                          </h3>
                          <p className="text-[11px] font-mono text-[#64748B] uppercase tracking-wider mt-1">
                            {search.channelTitle || "Unknown Origin"}
                          </p>
                        </div>
                        <button 
                          onClick={() => handleDeleteSearch(search.id)}
                          className="text-[#334155] hover:text-[#EF4444] transition-colors p-1"
                        >
                          <Icon icon="solar:trash-bin-trash-linear" size={18} />
                        </button>
                      </div>
                      
                      <p className="text-[#94A3B8] text-sm line-clamp-2 mb-6 leading-relaxed">
                        {search.snippet}
                      </p>

                      <div className="flex items-center justify-between gap-4">
                        <div className="flex gap-4">
                          <span className="flex items-center gap-1.5 text-[10px] font-mono text-[#475569] uppercase tracking-widest">
                            <Icon icon="solar:calendar-linear" size={12} />
                            {new Date(search.savedAt).toLocaleDateString()}
                          </span>
                          {search.viewCount !== undefined && (
                             <span className="flex items-center gap-1.5 text-[10px] font-mono text-[#475569] uppercase tracking-widest">
                              <Icon icon="solar:eye-linear" size={12} />
                              {search.viewCount} views
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => handleViewAnalysis(search.analysisId)}
                          className="text-[11px] font-mono text-[#06B6D4] uppercase tracking-[0.12em] flex items-center gap-2 hover:translate-x-1 transition-transform"
                        >
                          Access Synthesis <Icon icon="solar:arrow-right-linear" size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      <Footer />

      {deleteConfirm.element}

      <style jsx global>{`
        @keyframes hx-rise { 
          from { opacity: 0; transform: translateY(12px); } 
          to { opacity: 1; transform: translateY(0); } 
        }
        .animate-hx-rise { animation: hx-rise 520ms cubic-bezier(0.22, 1, 0.36, 1) both; }
        
        .btn-primary { 
          background: #0891B2; 
          color: #0B0E14; 
          padding: 10px 24px; 
          border-radius: 8px; 
          font-family: var(--font-sans); 
          font-weight: 600; 
          font-size: 14px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
      `}</style>
    </div>
  );
}
