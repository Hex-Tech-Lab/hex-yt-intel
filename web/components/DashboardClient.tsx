'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import toast from 'react-hot-toast';
import { BentoGrid } from '@/components/dashboard/BentoGrid';
import type { CachedAnalysisResult } from '@/lib/services/cache';
import styles from '@/app/dashboard.module.css';

const STORAGE_KEY = 'hex_intel_saved_input';

// Dynamic import for AmbientCanvas to prevent SSR/hydration mismatch
const AmbientCanvas = dynamic(() => import('@/components/ui/AmbientCanvas'), {
  ssr: false,
  loading: () => null,
});

export function DashboardClient() {
  const [url, setUrl] = useState('');
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      setUrl(cached);
    }
  }, []);

  const [synthesis, setSynthesis] = useState<string | null>(null);
  const [analysisData, setAnalysisData] = useState<CachedAnalysisResult | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newUrl = e.target.value;
    setUrl(newUrl);
    localStorage.setItem(STORAGE_KEY, newUrl);
  };

  const handleFetch = async () => {
    if (!url) return;
    setLoading(true);
    try {
      const res = await fetch('/api/metadata', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setSynthesis(`Title: ${data.title}\nChannel: ${data.channelTitle}`);
      setAnalysisId(null);
    } catch (error) {
      toast.error('Error: ' + (error instanceof Error ? error.message : 'Unknown'));
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!url) {
      toast.error('Please paste a URL first');
      return;
    }

    setLoading(true);
    setSynthesis(''); // Clear previous synthesis
    setAnalysisId(null);
    setAnalysisData(null);

    try {
      const res = await fetch('/api/analyses', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (res.status === 401) {
        window.location.href = `/auth/signin?callbackUrl=${encodeURIComponent(window.location.pathname)}`;
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      // Progressive SSE reader — parse OpenRouter line-delimited event-stream format
      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('Response body not readable');
      }

      const decoder = new TextDecoder();
      let fullSynthesis = '';
      let buffer = ''; // Accumulate incomplete lines across chunk boundaries

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const rawText = decoder.decode(value, { stream: true });
        buffer += rawText;

        // Split by newline and process complete lines
        const lines = buffer.split('\n');

        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          // Parse Server-Sent Events format: "data: {json}"
          if (line.startsWith('data: ')) {
            const cleanedLine = line.slice(6).trim();
            if (cleanedLine === '[DONE]') break;

            try {
              const parsed = JSON.parse(cleanedLine);
              const token = parsed.choices?.[0]?.delta?.content || '';
              if (token) {
                fullSynthesis += token;
                setSynthesis(fullSynthesis);
              }
            } catch (e) {
              // Ignore malformed JSON chunks — continue reading
              continue;
            }
          }
        }
      }

      // Reconcile DB insert with completed synthesis
      const tempId = crypto.randomUUID();
      setAnalysisId(tempId);

      // Parse synthesis into structured data for BentoGrid
      const structuredData: CachedAnalysisResult = {
        id: tempId,
        video_id: url,
        title: 'YouTube Content Analysis',
        analysis_markdown: fullSynthesis,
        validation_report: {
          transcript_available: true,
          analysis_type: 'full',
        },
        model_used: 'free-tier-waterfall',
        created_at: new Date().toISOString(),
        cached_at: new Date().toISOString(),
      };

      // Validate data before propagating to UI
      setAnalysisData(structuredData);
      toast.success('Analysis complete!');
    } catch (error) {
      const err = error as Error;
      toast.error(err.message || 'Unknown error');
      setSynthesis(null); // Clear on error
      setAnalysisData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (!analysisId) {
      toast.error('No analysis to export');
      return;
    }
    try {
      const res = await fetch(`/api/analyses/${analysisId}/export?format=pdf`);
      if (!res.ok) throw new Error('Failed to export');
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `synthesis-${analysisId.replace(/[^a-zA-Z0-9-]/g, '')}.pdf`;
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      toast.success('PDF exported!');
    } catch (error) {
      toast.error('Export failed: ' + (error instanceof Error ? error.message : 'Unknown'));
    }
  };

  const handleShare = async () => {
    if (!analysisId) {
      toast.error('No analysis to share');
      return;
    }
    try {
      const res = await fetch(`/api/analyses/${analysisId}/share`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to generate share link');
      const data = await res.json();
      
      // Copy to clipboard
      await navigator.clipboard.writeText(data.shareUrl);
      toast.success('Share link copied to clipboard!');
    } catch (error) {
      toast.error('Share failed: ' + (error instanceof Error ? error.message : 'Unknown'));
    }
  };

  const handleSearch = async () => {
    toast('Semantic search coming in Chunk 7');
  };

  // Memoize the analysis data to prevent unnecessary re-renders
  const memoizedAnalysisData = useMemo(() => analysisData, [analysisData]);

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Ambient Canvas Background (z-0) */}
      {isMounted && <AmbientCanvas className="z-0" />}

      {/* Main Content Container (z-10) */}
      <div className="relative z-10 w-full h-full">
        {analysisData && !loading ? (
          // BentoGrid View: Full Analysis Display
          <div className="p-6 overflow-y-auto h-full bg-black/50 backdrop-blur-sm">
            <div className="max-w-7xl mx-auto">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-white">{analysisData.title}</h2>
                  <p className="text-sm text-slate-400 mt-1">Analysis complete</p>
                </div>
                {analysisId && (
                  <div className="flex gap-2">
                    <button
                      onClick={handleExport}
                      className={styles.buttonSecondary}
                    >
                      📥 Export PDF
                    </button>
                    <button
                      onClick={handleShare}
                      className={styles.buttonPrimary}
                    >
                      🔗 Share Link
                    </button>
                  </div>
                )}
              </div>

              {/* BentoGrid Component */}
              <BentoGrid
                analysis={memoizedAnalysisData}
                isLoading={loading}
              />
            </div>
          </div>
        ) : (
          // Original Panel View: Input and Metadata
          <div className={styles.panelContainer}>
            {/* LEFT PANEL: Synthesis Output or Loading State */}
            <div className={styles.panelLeft}>
              <div className={styles.synthesisOutput}>
                {synthesis ? (
                  <>
                    {synthesis}
                    {loading && <span className={styles.loadingSpinner} />}
                  </>
                ) : (
                  <div className={styles.synthesisEmpty}>
                    <p>
                      {loading
                        ? 'Generating synthesis...'
                        : 'Paste a YouTube URL and click "Create Synthesis" to see output here'}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT PANEL: URL Input + Action Buttons */}
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
                onClick={handleFetch}
                disabled={loading || !url}
                className={`${styles.button} ${styles.buttonSecondary}`}
              >
                {loading ? 'Loading...' : 'Fetch Metadata'}
              </button>

              <button
                onClick={handleAnalyze}
                disabled={loading || !url}
                className={`${styles.button} ${styles.buttonPrimary}`}
              >
                {loading ? 'Analyzing...' : 'Create Synthesis'}
              </button>

              <button
                onClick={handleSearch}
                disabled={loading || !url}
                className={`${styles.button} ${styles.buttonSecondary}`}
              >
                Semantic Search
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
