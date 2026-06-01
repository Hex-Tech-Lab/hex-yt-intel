'use client';

import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useSSEStream } from '@/hooks/useSSEStream';
import { AnalysisState } from '@/components/dashboard/AnalysisState';

const STORAGE_KEY = 'hex_intel_saved_input';

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


  return (
    <div className="flex w-full h-full bg-black/50 backdrop-blur-sm">
      {/* LEFT SIDEBAR: URL Input & Actions (320px) */}
      <div className="w-80 flex-shrink-0 flex flex-col gap-6 p-6 border-r border-border overflow-y-auto">
        <div>
          <label className="text-xs font-mono font-semibold text-slate-300 uppercase tracking-wider">
            Paste YouTube URL
          </label>
          <Input
            type="text"
            placeholder="https://youtube.com/watch?v=..."
            value={isMounted ? url : ''}
            onChange={handleUrlChange}
            className="mt-3"
          />
        </div>

        <Button
          onClick={handleAnalyze}
          disabled={isLoading || !url}
          variant="default"
        >
          {isLoading ? 'Analyzing...' : 'Analyze'}
        </Button>

        <Button
          disabled={isLoading || !url}
          variant="outline"
        >
          Semantic Search
        </Button>

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
          <AnalysisState status={status} analysis={analysis} isLoading={isLoading} error={error} url={url} />
        </div>
      </div>
    </div>
  );
}
