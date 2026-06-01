'use client';

import dynamic from 'next/dynamic';
import { Card } from '@/components/ui/card';
import { AnalysisError } from '@/components/dashboard/AnalysisError';
import { BentoGridLoading } from '@/components/dashboard/BentoGridLoading';
import type { AnalysisResult, AnalysisStatus } from '@/lib/types';
import type { CachedAnalysisResult } from '@/lib/services/cache';
import { useMemo } from 'react';

const BentoGrid = dynamic(() => import('@/components/dashboard/BentoGrid'), {
  ssr: false,
});

interface AnalysisStateProps {
  status: AnalysisStatus;
  analysis: AnalysisResult | null;
  isLoading: boolean;
  error: string | null;
  url: string;
}

export function AnalysisState({
  status,
  analysis,
  isLoading,
  error,
  url,
}: AnalysisStateProps) {
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

  // Empty state: idle with no loading or analysis
  if (status === 'idle' && !isLoading && !analysis && !error) {
    return (
      <Card className="border border-border bg-surface/30 rounded-lg p-12 text-center">
        <div className="text-text-secondary space-y-2">
          <p className="text-lg font-medium">Paste a YouTube URL and click Analyze</p>
          <p className="text-sm">to see content analysis, transcript extraction, and structured intelligence here</p>
        </div>
      </Card>
    );
  }

  // Loading state: downloading, parsing, analyzing, or initial load
  if (
    status === 'downloading' ||
    status === 'parsing' ||
    status === 'analyzing' ||
    (isLoading && !analysis)
  ) {
    return <BentoGridLoading />;
  }

  // Complete state: analysis finished
  if (status === 'complete' || analysis) {
    return (
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
              className="px-4 py-2 bg-primary/10 text-accent border border-border rounded-control hover:bg-primary/20 text-sm transition-all disabled:opacity-30"
              disabled={!analysis?.id}
            >
              📥 Export PDF
            </button>
            <button
              className="px-4 py-2 bg-primary text-black font-medium rounded-control hover:shadow-[0_0_30px_rgba(6,182,212,0.4)] text-sm transition-all disabled:opacity-30"
              disabled={!analysis?.id}
            >
              🔗 Share Link
            </button>
          </div>
        </div>
        <BentoGrid analysis={bentoCachedAnalysis} />
      </div>
    );
  }

  // Error state
  if (status === 'error' || error) {
    return <AnalysisError error={error} url={url} />;
  }

  // Fallback (shouldn't reach here with proper state management)
  return null;
}
