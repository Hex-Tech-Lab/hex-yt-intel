'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import toast from 'react-hot-toast';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useSSEStream } from '@/hooks/useSSEStream';
import { Card } from '@/components/ui/card';
import type { CachedAnalysisResult } from '@/lib/services/cache';

const STORAGE_KEY = 'hex_intel_saved_input';

// Dynamic imports to prevent SSR/hydration mismatch
const BentoGrid = dynamic(() => import('@/components/dashboard/BentoGrid'), {
  ssr: false,
  loading: () => <BentoGridSkeleton />,
});

const BentoGridSkeleton = () => (
  <div className="grid grid-cols-1 md:grid-cols-6 gap-6">
    {[...Array(6)].map((_, i) => (
      <div key={i} className="md:col-span-2 h-64 bg-surface/50 border border-border/50 animate-pulse rounded-[2rem]" />
    ))}
  </div>
);

const getUserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

export function DashboardClient() {
  const [url, setUrl] = useState('');
  const [isMounted, setIsMounted] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    setIsMounted(true);
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      setUrl(cached);
    }
  }, []);

  // Zustand store for analysis state
  const { analysis, status, error, isLoading } = useAnalysisStore();
  const { startAnalysis } = useSSEStream();

  // Determine if we should show the dashboard view (anything other than idle)
  const showDashboard = useMemo(() => {
    return status !== 'idle' || isLoading || !!analysis || !!error;
  }, [status, isLoading, analysis, error]);

  // URL change handler with localStorage persistence
  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newUrl = e.target.value;
    setUrl(newUrl);
    localStorage.setItem(STORAGE_KEY, newUrl);
  };

  // Analyze handler
  const handleAnalyze = useCallback(async () => {
    if (!url) {
      toast.error('Please paste a URL first');
      return;
    }
    await startAnalysis(url, getUserTimezone());
  }, [url, startAnalysis]);

  // Export handler
  const handleExport = async () => {
    if (!analysis?.id) {
      toast.error('No analysis to export');
      return;
    }
    try {
      const res = await fetch(`/api/analyses/${analysis.id}/export?format=pdf`);
      if (!res.ok) throw new Error('Failed to export');
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `synthesis-${analysis.id.replace(/[^a-zA-Z0-9-]/g, '')}.pdf`;
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      toast.success('PDF exported!');
    } catch (error) {
      toast.error('Export failed: ' + (error instanceof Error ? error.message : 'Unknown'));
    }
  };

  // Share handler
  const handleShare = async () => {
    if (!analysis?.id) {
      toast.error('No analysis to share');
      return;
    }
    try {
      const res = await fetch(`/api/analyses/${analysis.id}/share`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to generate share link');
      const data = await res.json();
      await navigator.clipboard.writeText(data.shareUrl);
      toast.success('Share link copied to clipboard!');
    } catch (error) {
      toast.error('Share failed: ' + (error instanceof Error ? error.message : 'Unknown'));
    }
  };

  // Adapt AnalysisResult to CachedAnalysisResult for BentoGrid
  const bentoCachedAnalysis = useMemo<CachedAnalysisResult | null>(() => {
    if (!analysis) return null;
    return {
      id: analysis.id,
      video_id: url,
      title: analysis.title,
      analysis_markdown: analysis.analysis_markdown,
      validation_report: {
        transcript_available: true,
        analysis_type: 'full',
      },
      model_used: 'analysis',
      created_at: new Date().toISOString(),
      cached_at: new Date().toISOString(),
    };
  }, [analysis, url]);

  return (
    <div className="flex w-full h-full bg-black/50 backdrop-blur-sm">
      {/* LEFT SIDEBAR: URL Input & Actions (320px) */}
      <div className="w-80 flex-shrink-0 flex flex-col gap-6 p-6 border-r border-border overflow-y-auto">
        <div>
          <label className="text-xs font-mono font-semibold text-text-secondary uppercase tracking-wider">
            Paste YouTube URL
          </label>
          <input
            type="text"
            placeholder="https://youtube.com/watch?v=..."
            value={isMounted ? url : ''}
            onChange={handleUrlChange}
            className="w-full mt-3 bg-surface/30 border border-border rounded-control px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-accent focus:bg-accent/10 text-sm font-sans transition-all"
          />
        </div>

        <button
          onClick={handleAnalyze}
          disabled={isLoading || !url}
          className="w-full bg-primary text-black font-medium rounded-control py-3 hover:shadow-[0_0_30px_rgba(6,182,212,0.4)] hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Analyzing...' : 'Analyze'}
        </button>

        <button
          disabled={isLoading || !url}
          className="w-full bg-primary/10 text-accent border border-border rounded-control py-2.5 hover:bg-primary/20 hover:border-accent transition-all text-sm disabled:opacity-50"
        >
          Semantic Search
        </button>

        <hr className="border-border" />

        <div className="space-y-2">
          <a
            href="/analyses/saved"
            className="block text-sm text-text-secondary hover:text-accent transition-colors"
          >
            Saved Analyses
          </a>
          <a
            href="/pricing"
            className="block text-sm text-text-secondary hover:text-accent transition-colors"
          >
            Pricing
          </a>
        </div>
      </div>

      {/* RIGHT AREA: Results (flex-1) */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-7xl mx-auto">
          {!showDashboard ? (
            // Empty state
            <Card className="border border-border bg-surface/30 rounded-lg p-12 text-center">
              <div className="text-text-secondary space-y-2">
                <p className="text-lg font-medium">Paste a YouTube URL and click Analyze</p>
                <p className="text-sm">to see content analysis, transcript extraction, and structured intelligence here</p>
              </div>
            </Card>
          ) : (status === 'downloading' || status === 'parsing' || status === 'analyzing' || (isLoading && !analysis)) ? (
            // Loading skeleton
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="h-8 bg-surface/50 rounded animate-pulse w-1/3" />
                  <div className="h-4 bg-surface/30 rounded animate-pulse w-1/4 mt-2" />
                </div>
              </div>
              <BentoGridSkeleton />
            </div>
          ) : (status === 'complete' || analysis) ? (
            // Results display
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-white">{analysis?.title || 'Video Analysis'}</h2>
                  <p className="text-sm text-slate-400 mt-1">
                    {status === 'complete' ? 'Analysis complete' : 'Analyzing content...'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleExport}
                    disabled={!analysis?.id}
                    className="px-4 py-2 bg-primary/10 text-accent border border-border rounded-control hover:bg-primary/20 text-sm transition-all disabled:opacity-30"
                  >
                    📥 Export PDF
                  </button>
                  <button
                    onClick={handleShare}
                    disabled={!analysis?.id}
                    className="px-4 py-2 bg-primary text-black font-medium rounded-control hover:shadow-[0_0_30px_rgba(6,182,212,0.4)] text-sm transition-all disabled:opacity-30"
                  >
                    🔗 Share Link
                  </button>
                </div>
              </div>
              <BentoGrid analysis={bentoCachedAnalysis} isLoading={false} />
              
              {status === 'error' && (
                <div className="mt-8">
                   <h3 className="text-sm font-mono text-red-400 uppercase tracking-widest mb-4">System Resilience Intercept</h3>
                   <BentoGrid analysis={{
                    id: 'error',
                    video_id: url,
                    title: 'Processing Exception Intercepted',
                    analysis_markdown: `### DIMENSION 1 – ERROR_REPORT\n${error || 'An unexpected error occurred during processing.'}\n\n### DIMENSION 10 – RISK_ASSESSMENT\nSYSTEM_STATE: RECOVERED_VIA_DEGRADATION\nMITIGATION: USER_RETAINED_IN_DASHBOARD`,
                    validation_report: { transcript_available: false, analysis_type: 'metadata-only', warning: error || 'Analysis failed' },
                    model_used: 'error-handler',
                    created_at: new Date().toISOString(),
                    cached_at: new Date().toISOString()
                  }} />
                </div>
              )}
            </div>
          ) : status === 'error' ? (
            // Fallback Error state if no analysis started at all
            <div className="space-y-6">
               <h2 className="text-2xl font-bold text-white">Analysis Failed</h2>
               <BentoGrid analysis={{
                    id: 'error',
                    video_id: url,
                    title: 'Initialization Error',
                    analysis_markdown: `### DIMENSION 1 – ERROR_DETAILS\n${error || 'Failed to initialize analysis sequence.'}\n\n### DIMENSION 10 – RISK_ASSESSMENT\nCRITICAL_FAILURE: EJECTION_PREVENTED`,
                    validation_report: { transcript_available: false, analysis_type: 'metadata-only', warning: error || 'Initialization failed' },
                    model_used: 'error-handler',
                    created_at: new Date().toISOString(),
                    cached_at: new Date().toISOString()
                  }} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
