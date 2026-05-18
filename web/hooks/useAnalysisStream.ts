'use client';

import { useState, useCallback, useEffect } from 'react';

export interface UseAnalysisStreamReturn {
  startAnalysis: (url: string, timezone: string) => Promise<void>;
  clearAnalysis: () => void;
  analysis: { id: string; title: string; markdown: string } | null;
  isLoading: boolean;
  status: 'idle' | 'downloading' | 'parsing' | 'analyzing' | 'complete' | 'error';
  error: string | null;
  lockoutTimeRemaining: number;
}

/**
 * Custom hook for handling YouTube content analysis streaming
 * Manages API fetch, JSON caching, and real-time stream parsing
 */
export function useAnalysisStream(): UseAnalysisStreamReturn {
  const [analysis, setAnalysis] = useState<{ id: string; title: string; markdown: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'downloading' | 'parsing' | 'analyzing' | 'complete' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lockoutTimeRemaining, setLockoutTimeRemaining] = useState(0);

  // Manage lockout countdown timer
  useEffect(() => {
    if (lockoutTimeRemaining <= 0) return;

    const interval = setInterval(() => {
      setLockoutTimeRemaining((prev) => {
        const newValue = prev - 1;
        if (newValue <= 0) {
          clearInterval(interval);
          return 0;
        }
        return newValue;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [lockoutTimeRemaining]);

  const clearAnalysis = useCallback(() => {
    setAnalysis(null);
    setError(null);
    setStatus('idle');
  }, []);

  const startAnalysis = useCallback(async (url: string, timezone: string): Promise<void> => {
    if (!url.trim()) return;

    setIsLoading(true);
    setAnalysis(null);
    setError(null);
    setStatus('downloading');

    try {
      const response = await fetch('/api/analyses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          timezone,
        }),
      });

      // Handle rate limiting
      if (!response.ok) {
        if (response.status === 429) {
          const retryHeader = response.headers.get('Retry-After');
          const lockoutTime = retryHeader ? parseInt(retryHeader, 10) : 60;
          setLockoutTimeRemaining(lockoutTime);
          setError('Rate limited. Please wait before trying again.');
          setStatus('error');
          console.warn('Rate limited: Please wait before trying again');
          return;
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      // Check for Cache Hit (Standard JSON Response)
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        setStatus('parsing');
        const data = await response.json();
        setAnalysis({
          id: data.id || 'cached',
          title: data.title || 'Analysis',
          markdown: data.markdown || '',
        });
        setStatus('complete');
        return;
      }

      // Stream Reader Fallback (OpenRouter Streaming Pathway)
      setStatus('analyzing');
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('Failed to initialize stream reader');

      setAnalysis({ id: 'generating', title: 'Analysis in Progress', markdown: '' });
      let currentMarkdown = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Hold trailing incomplete chunk in memory

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.substring(6);
            if (dataStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(dataStr);
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) {
                currentMarkdown += content;
                setAnalysis((prev) => (prev ? { ...prev, markdown: currentMarkdown } : null));
              }
            } catch (e) {
              // Safely ignore mid-stream fragment decode errors
            }
          }
        }
      }

      setStatus('complete');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('Error analyzing video:', err);
      setError(`Failed to analyze video: ${errorMessage}`);
      setStatus('error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    startAnalysis,
    clearAnalysis,
    analysis,
    isLoading,
    status,
    error,
    lockoutTimeRemaining,
  };
}
