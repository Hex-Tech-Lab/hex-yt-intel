'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import toast from 'react-hot-toast';
import { BentoGrid } from '@/components/dashboard/BentoGrid';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useSSEStream } from '@/hooks/useSSEStream';
import type { CachedAnalysisResult } from '@/lib/services/cache';
import styles from '@/app/dashboard.module.css';

const STORAGE_KEY = 'hex_intel_saved_input';

// Dynamic import for AmbientCanvas to prevent SSR/hydration mismatch
const AmbientCanvas = dynamic(() => import('@/components/ui/AmbientCanvas'), {
  ssr: false,
  loading: () => null,
});

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

  // Single source of truth: Zustand store + the shared SSE hook.
  // No local analysis/synthesis/loading state, no manual fetch/SSE pipeline.
  const { startAnalysis } = useSSEStream();
  const { analysis, isLoading, status, error, clearAnalysis } = useAnalysisStore();

  useEffect(() => {
    setIsMounted(true);
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) setUrl(cached);
  }, []);

  // Surface store errors to the user without holding a parallel error state.
  useEffect(() => {
    if (status === 'error' && error) toast.error(error);
  }, [status, error]);

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newUrl = e.target.value;
    setUrl(newUrl);
    localStorage.setItem(STORAGE_KEY, newUrl);
  };

  const handleAnalyze = async () => {
    if (!url) {
      toast.error('Please paste a URL first');
      return;
    }
    await startAnalysis(url, getUserTimezone());
  };

  const handleReset = () => {
    clearAnalysis();
  };

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
    } catch (err) {
      toast.error('Export failed: ' + (err instanceof Error ? err.message : 'Unknown'));
    }
  };

  const handleShare = async () => {
    if (!analysis?.id) {
      toast.error('No analysis to share');
      return;
    }
    try {
      const res = await fetch(`/api/analyses/${analysis.id}/share`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to generate share link');
      const data = await res.json();
      await navigator.clipboard.writeText(data.shareUrl);
      toast.success('Share link copied to clipboard!');
    } catch (err) {
      toast.error('Share failed: ' + (err instanceof Error ? err.message : 'Unknown'));
    }
  };

  // Bridge the store's lean AnalysisResult into BentoGrid's CachedAnalysisResult view shape.
  const analysisData = useMemo<CachedAnalysisResult | null>(() => {
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
      model_used: 'free-tier-waterfall',
      created_at: new Date().toISOString(),
      cached_at: new Date().toISOString(),
    };
  }, [analysis, url]);

  // BentoGrid shows during streaming and on completion; the input panel shows otherwise.
  const isStreaming = isLoading && (!analysis || analysis.analysis_markdown.length === 0);

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Ambient Canvas Background (z-0) */}
      {isMounted && <AmbientCanvas className="z-0" />}

      {/* Main Content Container (z-10) */}
      <div className="relative z-10 w-full h-full">
        {analysisData ? (
          // Analysis view — driven entirely by the store
          <div className="p-6 overflow-y-auto h-full bg-black/50 backdrop-blur-sm">
            <div className="max-w-7xl mx-auto">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-white">{analysisData.title}</h2>
                  <p className="text-sm text-slate-400 mt-1">
                    {status === 'complete' ? 'Analysis complete' : 'Synthesizing…'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleReset} className={styles.buttonSecondary}>
                    ← New
                  </button>
                  {status === 'complete' && (
                    <>
                      <button onClick={handleExport} className={styles.buttonSecondary}>
                        📥 Export PDF
                      </button>
                      <button onClick={handleShare} className={styles.buttonPrimary}>
                        🔗 Share Link
                      </button>
                    </>
                  )}
                </div>
              </div>

              <BentoGrid analysis={analysisData} isLoading={isStreaming} />
            </div>
          </div>
        ) : (
          // Input panel
          <div className={styles.panelContainer}>
            <div className={styles.panelLeft}>
              <div className={styles.synthesisOutput}>
                <div className={styles.synthesisEmpty}>
                  <p>
                    {isLoading
                      ? 'Generating synthesis…'
                      : 'Paste a YouTube URL and click "Create Synthesis" to see output here'}
                  </p>
                </div>
              </div>
            </div>

            <div className={styles.panelRight}>
              <div className={styles.inputGroup}>
                <label className={styles.inputLabel}>Paste YouTube URL</label>
                <input
                  type="text"
                  placeholder="https://youtube.com/watch?v=..."
                  value={isMounted ? url : ''}
                  onChange={handleUrlChange}
                  className={styles.input}
                />
              </div>

              <button
                onClick={handleAnalyze}
                disabled={isLoading || !url}
                className={`${styles.button} ${styles.buttonPrimary}`}
              >
                {isLoading ? 'Analyzing…' : 'Create Synthesis'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
